# 7 фич из JHenTai — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать менеджер загрузок, синхронизацию обновлений, архивы (локальные + EH), домен-фронтинг, восстановление позиции чтения, обработку лимитов EH и PIN-лок — по спеке `docs/superpowers/specs/2026-09-13-jhentai-features-design.md`.

**Architecture:** Вся новая серверная логика — в main-процессе Electron (`src/main/services/`), стиль существующей кодовой базы: чистый TS, `httpFetch` для сети, JSON-файлы в userData для стейта, типизированный IPC через `src/shared/ipc.ts`, React-экраны в `src/renderer/src/screens/`. Сеть и файлы никогда не в renderer.

**Tech Stack:** TypeScript, Electron 33, React 18, vitest, yauzl ^3.4.0 (единственная новая зависимость, уже есть в node_modules).

## Global Constraints

- Вся сеть — только через `httpFetch`/`httpFetchBinary` из `src/main/services/http.ts` (получает Tor/fronting/куки бесплатно).
- Состояние загрузок — `userData/downloads.json`; PIN — `userData/pin.json`; никогда не в settings.json.
- Русские пользовательские сообщения об ошибках (как в `ehErrorFromResponse`).
- Тесты в `tests/`, vitest, окружение node, фикстуры — `tests/fixtures/`.
- После каждого таска: `npm run typecheck && npm test` должны проходить.
- Не менять Rust-оригинал, не трогать существующие парсеры.

---

### Task 1: eh-limits.ts — детект и парсинг лимитов EH

**Files:**
- Create: `src/main/services/eh-limits.ts`
- Test: `tests/eh-limits.test.ts`

**Interfaces:**
- Consumes: ничего (чистая логика).
- Produces: `parseLimitResponse(text: string): { kind: 'image-limit' | 'usage-limit' | 'sad-panda' | null, resetAfterSec: number | null }`, `EhLimitState { blocked: boolean, until: number, kind: string }`, `EhLimitWatcher` class: `parse(text)`, `isBlocked(): boolean`, `block(kind, untilMs)`, `remainingSec(): number`, `onChange(cb)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseLimitResponse, EhLimitWatcher } from '../src/main/services/eh-limits'

describe('parseLimitResponse', () => {
  it('detects image limit page', () => {
    expect(parseLimitResponse('You have exceeded your image viewing limits. Please try again later.').kind).toBe('image-limit')
  })
  it('detects usage limit with reset seconds', () => {
    const r = parseLimitResponse('You have exceeded your usage limit. Your limits will be reset in 1234 seconds.')
    expect(r.kind).toBe('usage-limit')
    expect(r.resetAfterSec).toBe(1234)
  })
  it('detects sad panda empty body', () => {
    expect(parseLimitResponse('   ').kind).toBe('sad-panda')
  })
  it('returns null for normal page', () => {
    expect(parseLimitResponse('<html><body>ok</body></html>').kind).toBe(null)
  })
})

describe('EhLimitWatcher', () => {
  beforeEach(() => { vi.useFakeTimers() })
  it('blocks and unblocks after reset', () => {
    vi.setSystemTime(0)
    const w = new EhLimitWatcher()
    w.block('usage-limit', 1000)
    expect(w.isBlocked()).toBe(true)
    vi.setSystemTime(1001)
    expect(w.isBlocked()).toBe(false)
  })
  it('notifies onChange subscribers', () => {
    const w = new EhLimitWatcher()
    const seen: boolean[] = []
    w.onChange((b) => seen.push(b))
    w.block('image-limit', 60_000)
    w.clear()
    expect(seen).toEqual([true, false])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eh-limits.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface LimitParseResult {
  kind: 'image-limit' | 'usage-limit' | 'sad-panda' | null
  resetAfterSec: number | null
}

export function parseLimitResponse(text: string): LimitParseResult {
  if (!text || text.trim().length === 0) return { kind: 'sad-panda', resetAfterSec: null }
  const t = text.slice(0, 2000)
  if (t.startsWith('You have exceeded your image')) return { kind: 'image-limit', resetAfterSec: null }
  const m = t.match(/exceeded your usage limit[^.]*\.?[^]*?reset in\s*(\d+)\s*second/i)
  if (t.toLowerCase().includes('exceeded your usage limit')) {
    return { kind: 'usage-limit', resetAfterSec: m ? Number(m[1]) : null }
  }
  return { kind: null, resetAfterSec: null }
}

export interface EhLimitState {
  blocked: boolean
  until: number
  kind: string
}

export class EhLimitWatcher {
  private until = 0
  private kind = ''
  private cbs: ((s: EhLimitState) => void)[] = []

  private emit(): void {
    const s = this.state()
    for (const cb of this.cbs) cb(s)
  }

  state(): EhLimitState {
    return { blocked: Date.now() < this.until, until: this.until, kind: this.kind }
  }

  isBlocked(): boolean {
    return this.state().blocked
  }

  block(kind: string, durationMs: number): void {
    this.kind = kind
    this.until = Math.max(this.until, Date.now() + durationMs)
    this.emit()
  }

  clear(): void {
    this.until = 0
    this.kind = ''
    this.emit()
  }

  remainingSec(): number {
    return Math.max(0, Math.ceil((this.until - Date.now()) / 1000))
  }

  onChange(cb: (s: EhLimitState) => void): void {
    this.cbs.push(cb)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/eh-limits.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/eh-limits.ts tests/eh-limits.test.ts
git commit -m "feat(limits): parse EH limit pages and track global block state"
```

---

### Task 2: Интеграция eh-limits в http.ts + авто-переключение аккаунта

**Files:**
- Create: `src/main/services/eh-limits-hook.ts`
- Modify: `src/main/services/http.ts` (в `httpFetch`, после `extractSetCookies`)
- Modify: `src/main/services/catalog-search.ts:137-154` (`ehErrorFromResponse` использует watcher)
- Test: `tests/eh-limits-hook.test.ts`

**Interfaces:**
- Consumes: `EhLimitWatcher`, `parseLimitResponse` из Task 1.
- Produces: `registerEhLimitHook(opts: { watcher: EhLimitWatcher, switchAccount?: () => boolean, retryOnce: <T>(fn: () => Promise<T>) => Promise<T> })`, `ehBlockedError(): Error` — ошибка с полем `.ehBlocked = true` и русским сообщением с таймером. Внутри `httpFetch`: если URL — EH-хост и watcher заблокирован → немедленный throw `ehBlockedError()`; если ответ распарсился как лимит → watcher.block() и одна попытка `switchAccount()` (если вернёт true — retry, иначе throw).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { EhLimitWatcher } from '../src/main/services/eh-limits'
import { registerEhLimitHook, ehBlockedError } from '../src/main/services/eh-limits-hook'

describe('eh-limits-hook', () => {
  it('ehBlockedError carries flag and russian message', () => {
    const e = ehBlockedError('usage-limit', 123)
    expect((e as any).ehBlocked).toBe(true)
    expect(e.message).toContain('лимит')
    expect(e.message).toContain('123')
  })
  it('retryOnce retries when switchAccount returns true', async () => {
    const w = new EhLimitWatcher()
    let calls = 0
    let switched = 0
    registerEhLimitHook({ watcher: w, switchAccount: () => { switched++; return true } })
    const result = await (globalThis as any).__ehLimitHandleRetryOnce(async () => {
      calls++
      if (calls === 1) { w.block('usage-limit', 60_000); throw ehBlockedError('usage-limit', 60) }
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(calls).toBe(2)
    expect(switched).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eh-limits-hook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/main/services/eh-limits-hook.ts`:

```ts
import type { EhLimitWatcher } from './eh-limits'

export function ehBlockedError(kind: string, remainingSec: number): Error {
  const label = kind === 'image-limit' ? 'Лимит изображений E-Hentai исчерпан' : 'Лимит использования E-Hentai исчерпан'
  const e = new Error(`${label}. Сброс через ${remainingSec} c. Включи domain fronting/Tor или смени аккаунт.`)
  ;(e as any).ehBlocked = true
  return e
}

interface HookOpts {
  watcher: EhLimitWatcher
  switchAccount?: () => boolean
}

let opts: HookOpts | null = null

export function registerEhLimitHook(o: HookOpts): void { opts = o }

export function handleLimitFailure(kind: string, resetAfterSec: number | null): Error {
  const w = opts?.watcher
  if (!w) return new Error('Лимит E-Hentai')
  const fallbackSec = resetAfterSec ?? 3600
  // one account-switch attempt before hard blocking
  if (opts?.switchAccount?.()) return ehBlockedError(kind, 0)
  w.block(kind, fallbackSec * 1000)
  return ehBlockedError(kind, w.remainingSec())
}

;(globalThis as any).__ehLimitHandleRetryOnce = async <T,>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch (e: any) {
    if (!e?.ehBlocked || !opts?.switchAccount?.()) throw e
    return await fn()
  }
}

export function isEhLimitError(e: unknown): boolean {
  return !!(e as any)?.ehBlocked
}
```

Modify `src/main/services/http.ts` — в `httpFetch` после `performFetch` добавить (до `extractSetCookies`):

```ts
import { parseLimitResponse } from './eh-limits'
import { isEhHost } from './eh-session'
import { handleLimitFailure } from './eh-limits-hook'
// ... в httpFetch после const { res, bodyText } = await performFetch(...):
const hostLower = (() => { try { return new URL(opts.url).hostname } catch { return '' } })()
if (hostLower.includes('exhentai') || hostLower.includes('e-hentai.org')) {
  const bodyForCheck = bodyText ?? (await res.text())
  const lim = parseLimitResponse(bodyForCheck.slice(0, 4000))
  if (lim.kind) throw handleLimitFailure(lim.kind, lim.resetAfterSec)
  if (bodyText === null && bodyForCheck !== '' ) { /* не текстовый протокол — ничего */ }
}
```

Важно: `httpFetch` уже возвращает text; для бинарных путей (`httpFetchBinary`) проверять только по content-type, добавив в `httpFetchBinary`:

```ts
const ct = res.headers.get('content-type') ?? ''
if (ct.includes('text/html')) {
  const buf = Buffer.from(await res.arrayBuffer())
  const lim = parseLimitResponse(buf.slice(0, 4000).toString('utf-8'))
  if (lim.kind) throw handleLimitFailure(lim.kind, lim.resetAfterSec)
}
```

- [ ] **Step 4: Run test to verify it passes + typecheck**

Run: `npx vitest run tests/eh-limits-hook.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/eh-limits-hook.ts src/main/services/http.ts tests/eh-limits-hook.test.ts
git commit -m "feat(limits): block EH requests during limit, auto-switch account"
```

---

### Task 3: EhLimitWatcher инстанс в main + событие в UI

**Files:**
- Create: `src/main/services/eh-limits-instance.ts`
- Modify: `src/main/index.ts` (регистрация после создания settings/exAccounts)
- Modify: `src/shared/ipc.ts` (каналы `ehLimits:state`, событие `ehLimitsChanged`)
- Test: ручной (событие уже покрыто тестом Task 1)

**Interfaces:**
- Consumes: `EhLimitWatcher` (Task 1), `registerEhLimitHook` (Task 2).
- Produces: singleton `ehWatcher`, `broadcastEhLimitState()`.

- [ ] **Step 1: Create instance module**

```ts
import { BrowserWindow } from 'electron'
import { EhLimitWatcher, type EhLimitState } from './eh-limits'

export const ehWatcher = new EhLimitWatcher()

export function broadcastEhLimitState(s: EhLimitState): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('eh-limits:changed', s)
}
```

В `src/main/index.ts` после `exAccounts.init()`:

```ts
import { ehWatcher, broadcastEhLimitState } from './services/eh-limits-instance'
import { registerEhLimitHook } from './services/eh-limits-hook'

registerEhLimitHook({
  watcher: ehWatcher,
  switchAccount: () => {
    const others = exAccounts.accounts.filter((a) => a.id !== exAccounts.currentId)
    if (others.length === 0) return false
    exAccounts.setCurrent(others[0].id)
    return true
  }
})
ehWatcher.onChange(broadcastEhLimitState)
ipcMain.handle('eh-limits:state', () => ehWatcher.state())
```

- [ ] **Step 2: Add to `src/shared/ipc.ts`**

В `CH` добавить:

```ts
ehLimitsState: 'eh-limits:state',
ehLimitsChanged: 'eh-limits:changed'
```

И использовать эти константы в `eh-limits-instance.ts` вместо литералов.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/services/eh-limits-instance.ts src/main/index.ts src/shared/ipc.ts
git commit -m "feat(limits): global watcher instance + UI event channel"
```

---

### Task 4: resolveGallery — вынос резолва из openUrl

**Files:**
- Create: `src/main/services/resolve-gallery.ts`
- Modify: `src/main/index.ts` (openUrl делегирует)
- Test: `tests/resolve-gallery.test.ts` (моки через vi.mock существующих модулей)

**Interfaces:**
- Consumes: `resolveAtHome/fetchChapterList/searchMangaDex` (mangadex), `fetchRemangaChapter/fetchSenkuroChapter` (sources), `fetchSimpleGallery` (simple-gallery), `mangaSeriesUrlFromChapterUrl`, `extractMangaDexChapterId` (вынести в resolve-gallery).
- Produces: `resolveGallery(url: string, opts: { proxy?: string, cookieHeader?: string }): Promise<GalleryResolution>` где

```ts
export interface GalleryResolution {
  title: string
  pageUrls: string[]
  coverUrl: string | null
  source: string
  referer: string | null
  mangaId: string | null
  seriesId: string
}
```

- [ ] **Step 1: Write the failing test** (моки модулей, проверяем маршрутизацию по URL)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/main/services/mangadex', () => ({
  resolveAtHome: async () => ({ baseUrl: 'https://x', hash: 'h', files: ['1.jpg', '2.jpg'] })
}))
vi.mock('../src/main/services/simple-gallery', () => ({
  fetchSimpleGallery: async () => ({ title: 'T', pageUrls: ['p1'], coverUrl: 'c', sourcePages: [null] })
}))

import { resolveGallery, extractMangaDexChapterId } from '../src/main/services/resolve-gallery'

describe('resolveGallery', () => {
  beforeEach(() => vi.clearAllMocks())
  it('routes mangadex chapter urls', async () => {
    const r = await resolveGallery('https://mangadex.org/chapter/abc-def-0000-0000-000000000000', {})
    expect(r.source).toBe('MangaDex')
    expect(r.pageUrls).toHaveLength(2)
    expect(r.pageUrls[0]).toBe('https://x/data/h/1.jpg')
  })
  it('routes nhentai to simple gallery', async () => {
    const r = await resolveGallery('https://nhentai.net/g/123/', {})
    expect(r.source).toBe('NHentai')
    expect(r.pageUrls).toEqual(['p1'])
  })
  it('extracts mangadex chapter id from uuid', () => {
    expect(extractMangaDexChapterId('b6f8a2b1-1a2b-3c4d-5e6f-7a8b9c0d1e2f')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/resolve-gallery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Перенести логику из `src/main/index.ts:178-239` (openUrl handler) в `resolve-gallery.ts`:

```ts
import { resolveAtHome } from './mangadex'
import { fetchRemangaChapter, fetchSenkuroChapter, mangaSeriesUrlFromChapterUrl } from './sources'
import { fetchSimpleGallery } from './simple-gallery'

export interface GalleryResolution {
  title: string
  pageUrls: string[]
  coverUrl: string | null
  source: string
  referer: string | null
  mangaId: string | null
  seriesId: string
}

function isUuid(s: string): boolean {
  return s.length === 36 && [...s].every((c, i) =>
    (i === 8 || i === 13 || i === 18 || i === 23) ? c === '-' : /[0-9a-fA-F]/.test(c))
}

export function extractMangaDexChapterId(url: string): string | null {
  const t = url.trim()
  if (t.includes('mangadex.org')) {
    const pos = t.indexOf('/chapter/')
    if (pos >= 0) {
      const seg = t.slice(pos + '/chapter/'.length).split('/')[0]
      if (seg) return seg
    }
  }
  if (isUuid(t)) return t
  return null
}

export function sourceLabel(url: string): string {
  const l = url.toLowerCase()
  if (l.includes('mangadex')) return 'MangaDex'
  if (l.includes('exhentai')) return 'ExHentai'
  if (l.includes('e-hentai.org')) return 'E-Hentai'
  if (l.includes('nhentai')) return 'NHentai'
  if (l.includes('com-x.life')) return 'Com-X'
  if (l.includes('senkuro')) return 'Senkuro'
  if (l.includes('manga-shi')) return 'Manga-shi'
  if (l.includes('remanga')) return 'Remanga'
  if (l.includes('mangalib')) return 'Mangalib'
  return ''
}

export async function resolveGallery(
  url: string,
  opts: { proxy?: string; cookieHeader?: string }
): Promise<GalleryResolution> {
  const trimmed = url.trim()
  const seriesId = mangaSeriesUrlFromChapterUrl(trimmed) ?? trimmed
  const chapterId = extractMangaDexChapterId(trimmed)
  if (chapterId) {
    const atHome = await resolveAtHome(chapterId)
    const pageUrls = atHome.files.map((f) => `${atHome.baseUrl}/data/${atHome.hash}/${f}`)
    return { title: `MangaDex Chapter ${chapterId}`, pageUrls, coverUrl: null, source: 'MangaDex', referer: 'https://mangadex.org/', mangaId: seriesId, seriesId }
  }
  if (trimmed.includes('remanga.org/manga/')) {
    const r = await fetchRemangaChapter(trimmed)
    return { title: r.title, pageUrls: r.pageUrls, coverUrl: null, source: 'Remanga', referer: 'https://remanga.org/', mangaId: seriesId, seriesId }
  }
  if (trimmed.includes('senkuro') && trimmed.includes('/chapter/')) {
    const r = await fetchSenkuroChapter(trimmed)
    return { title: r.title, pageUrls: r.pageUrls, coverUrl: null, source: 'Senkuro', referer: `${r.base}/`, mangaId: seriesId, seriesId }
  }
  if (trimmed.includes('manga-shi.') || trimmed.includes('nhentai') || trimmed.includes('com-x.life') || trimmed.includes('mangalib.') || trimmed.includes('e-hentai.org') || trimmed.includes('exhentai')) {
    const g = await fetchSimpleGallery(trimmed, { proxy: opts.proxy, cookieHeader: opts.cookieHeader })
    return { title: g.title, pageUrls: g.pageUrls, coverUrl: g.coverUrl, source: sourceLabel(trimmed), referer: trimmed, mangaId: seriesId, seriesId }
  }
  throw new Error('Неподдерживаемый URL')
}
```

В `src/main/index.ts` обработчик `CH.openUrl` заменяется на вызов `resolveGallery` с сохранением прокси/куки-логики (tor-ветки, cookieHeader), далее `createOnlineGallery(result.title, result.pageUrls, result.proxy)` — поведение идентично прежнему.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/resolve-gallery.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/resolve-gallery.ts src/main/index.ts tests/resolve-gallery.test.ts
git commit -m "refactor: extract gallery resolution into resolveGallery for downloads reuse"
```

---

### Task 5: DownloadManager — ядро очереди

**Files:**
- Create: `src/main/services/download-manager.ts`
- Test: `tests/download-manager.test.ts`

**Interfaces:**
- Consumes: `resolveGallery` (Task 4), `httpFetchBinary` (http.ts).
- Produces:

```ts
export interface DownloadTask {
  id: string
  title: string
  sourceUrl: string
  pageUrls: string[]
  headers: Record<string, string>
  proxy?: string
  outDir: string
  state: 'queued' | 'running' | 'paused' | 'completed' | 'error'
  priority: number
  completedPages: number[]
  totalPages: number
  error?: string
  addedAt: number
}

export class DownloadManager {
  constructor(outDirBase: string, persistPath: string, deps: {
    fetchBinary: (url: string, headers?: Record<string, string>, proxy?: string, timeoutMs?: number) => Promise<Uint8Array>
    broadcast: (tasks: DownloadTask[]) => void
  })
  add(sourceUrl: string, resolve: () => Promise<GalleryResolution>, headers: Record<string, string>, proxy?: string): Promise<DownloadTask | null> // null = дедуп
  pause(id: string): void
  resume(id: string): void
  remove(id: string): void
  setPriority(id: string, priority: number): void
  list(): DownloadTask[]
  loadPersisted(): void      // восстановление из JSON: queued/running → queued, скан outDir
}
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DownloadManager } from '../src/main/services/download-manager'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('DownloadManager', () => {
  let dir: string
  let persist: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dl-')); persist = join(dir, 'downloads.json') })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function makeManager(fetchBin?: any, broadcast = (_t: any) => {}): DownloadManager {
    const fb = fetchBin ?? (async (url: string) => new Uint8Array([1, 2, 3]))
    return new DownloadManager(join(dir, 'downloads'), persist, { fetchBinary: fb, broadcast })
  }

  it('downloads all pages to outDir and completes', async () => {
    const m = makeManager()
    const t = await m.add('https://x/g/1/', async () => ({
      title: 'Test', pageUrls: ['u1', 'u2', 'u3'], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's'
    }), {})
    expect(t).not.toBeNull()
    await m.waitIdle()
    expect(t!.state).toBe('completed')
    expect(existsSync(join(t!.outDir, '001.bin'))).toBe(true)
    expect(existsSync(join(t!.outDir, '003.bin'))).toBe(true)
  })

  it('dedups by sourceUrl', async () => {
    const m = makeManager()
    await m.add('https://x/g/1/', async () => ({
      title: 'T', pageUrls: ['u1'], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's'
    }), {})
    const t2 = await m.add('https://x/g/1/', async () => ({ title: 'T', pageUrls: [], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's' }), {})
    expect(t2).toBeNull()
    await m.waitIdle()
  })

  it('pause stops work, resume finishes', async () => {
    let gate: (() => void) | null = null
    const p = new Promise<void>((r) => { gate = r })
    const m = makeManager(async () => { await p; return new Uint8Array([9]) })
    const t = await m.add('https://x/g/1/', async () => ({
      title: 'T', pageUrls: ['u1', 'u2'], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's'
    }), {})
    await delay(10)
    m.pause(t!.id)
    expect(t!.state).toBe('paused')
    ;(gate as any)!()
    m.resume(t!.id)
    await m.waitIdle()
    expect(t!.state).toBe('completed')
  })

  it('resumes from existing files on loadPersisted', async () => {
    const out = join(dir, 'downloads', 'test-1')
    writeFileSync(join(out, '001.bin'), 'x')
    const m = makeManager()
    writeFileSync(persist, JSON.stringify([{
      id: '1', title: 'Test', sourceUrl: 'https://x/g/1/', pageUrls: ['u1', 'u2', 'u3'],
      headers: {}, outDir: out, state: 'running', priority: 0, completedPages: [0], totalPages: 3, addedAt: 0
    }]))
    m.loadPersisted()
    const t = m.list()[0]
    expect(t.completedPages).toEqual([0])
    expect(t.state).toBe('queued')
    await m.waitIdle()
    expect(t.state).toBe('completed')
  })

  it('priority order', async () => {
    const order: string[] = []
    let gate: (() => void) | null = null
    const p = new Promise<void>((r) => { gate = r })
    const m = makeManager(async (url: string) => { order.push(url); await p; return new Uint8Array([1]) })
    const a = await m.add('https://x/g/a/', async () => ({ title: 'A', pageUrls: ['a1'], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 'a' }), {})
    const b = await m.add('https://x/g/b/', async () => ({ title: 'B', pageUrls: ['b1'], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 'b' }), {})
    m.setPriority(b!.id, 10)
    ;(gate as any)!()
    await m.waitIdle()
    expect(order.indexOf('b1')).toBeLessThan(order.indexOf('a1'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/download-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { randomUUID } from 'crypto'
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import { naturalSort } from './natural-sort'
import type { GalleryResolution } from './resolve-gallery'

export interface DownloadTask {
  id: string
  title: string
  sourceUrl: string
  pageUrls: string[]
  headers: Record<string, string>
  proxy?: string
  outDir: string
  state: 'queued' | 'running' | 'paused' | 'completed' | 'error'
  priority: number
  completedPages: number[]
  totalPages: number
  error?: string
  addedAt: number
}

export const PARALLEL = 3

function extFromUrl(url: string): string {
  const m = url.split('?')[0].match(/\.(\w{2,5})$/)
  const ext = m?.[1]?.toLowerCase()
  if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext)) return ext
  return 'bin'
}

function slugify(title: string, id: string): string {
  const base = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'gallery'
  return `${base}-${id.slice(0, 8)}`
}

export class DownloadManager {
  private tasks: DownloadTask[] = []
  private inFlight = 0
  private waiters: (() => void)[] = []
  private persistPath: string

  constructor(
    private outDirBase: string,
    persistPath: string,
    private deps: {
      fetchBinary: (url: string, headers?: Record<string, string>, proxy?: string, timeoutMs?: number) => Promise<Uint8Array>
      broadcast: (tasks: DownloadTask[]) => void
    }
  ) {
    this.persistPath = persistPath
    this.loadPersisted()
  }

  private persist(): void {
    try {
      mkdirSync(join(this.persistPath, '..'), { recursive: true })
      writeFileSync(this.persistPath, JSON.stringify(this.tasks, null, 2))
    } catch { /* ignore */ }
  }

  private notify(): void {
    this.persist()
    this.deps.broadcast(this.tasks.map((t) => ({ ...t })))
  }

  loadPersisted(): void {
    if (!existsSync(this.persistPath)) return
    try {
      const raw = JSON.parse(readFileSync(this.persistPath, 'utf-8')) as DownloadTask[]
      this.tasks = raw.map((t) => ({ ...t, state: t.state === 'running' || t.state === 'queued' ? 'queued' : t.state }))
    } catch { this.tasks = [] }
    for (const t of this.tasks) {
      if (t.state !== 'queued') continue
      // rescan outDir for already-downloaded pages
      if (existsSync(t.outDir)) {
        const have = new Set(readdirSync(t.outDir))
        t.completedPages = t.pageUrls
          .map((_u, i) => i)
          .filter((i) => have.has(this.fileName(t, i)))
      }
      void this.pump()
    }
    this.notify()
  }

  fileName(t: DownloadTask, index: number): string {
    return `${String(index + 1).padStart(3, '0')}.${extFromUrl(t.pageUrls[index] ?? '')}`
  }

  private nextQueued(): DownloadTask | null {
    const cands = this.tasks.filter((t) => t.state === 'queued')
    if (cands.length === 0) return null
    cands.sort((a, b) => b.priority - a.priority || a.addedAt - b.addedAt)
    return cands[0]
  }

  private async pump(): Promise<void> {
    while (this.inFlight < PARALLEL) {
      const t = this.nextQueued()
      if (!t) break
      t.state = 'running'
      this.inFlight++
      void this.runTask(t).finally(() => {
        this.inFlight--
        this.notify()
        void this.pump()
        if (this.inFlight === 0 && !this.tasks.some((x) => x.state === 'queued' || x.state === 'running')) {
          const ws = this.waiters
          this.waiters = []
          for (const w of ws) w()
        }
      })
    }
  }

  private async runTask(t: DownloadTask): Promise<void> {
    mkdirSync(t.outDir, { recursive: true })
    for (let i = 0; i < t.pageUrls.length; i++) {
      if (t.state !== 'running') return
      if (t.completedPages.includes(i)) continue
      try {
        const buf = await this.deps.fetchBinary(t.pageUrls[i], t.headers, t.proxy, 60_000)
        writeFileSync(join(t.outDir, this.fileName(t, i)), Buffer.from(buf))
        t.completedPages.push(i)
        this.notify()
      } catch (e: any) {
        t.error = e?.message ?? String(e)
        t.state = 'error'
        this.notify()
        return
      }
    }
    if (t.state === 'running') t.state = 'completed'
    this.notify()
  }

  async add(sourceUrl: string, resolve: () => Promise<GalleryResolution>, headers: Record<string, string>, proxy?: string): Promise<DownloadTask | null> {
    if (this.tasks.some((t) => t.sourceUrl === sourceUrl && t.state !== 'error')) return null
    const res = await resolve()
    const task: DownloadTask = {
      id: randomUUID(), title: res.title, sourceUrl, pageUrls: res.pageUrls,
      headers, proxy, outDir: join(this.outDirBase, slugify(res.title, randomUUID())),
      state: 'queued', priority: 0, completedPages: [], totalPages: res.pageUrls.length,
      addedAt: Date.now()
    }
    this.tasks.push(task)
    this.notify()
    void this.pump()
    return task
  }

  pause(id: string): void {
    const t = this.tasks.find((x) => x.id === id)
    if (t && t.state === 'running') { t.state = 'paused'; this.notify() }
  }

  resume(id: string): void {
    const t = this.tasks.find((x) => x.id === id)
    if (t && (t.state === 'paused' || t.state === 'error')) { t.state = 'queued'; delete t.error; this.notify(); void this.pump() }
  }

  remove(id: string): void {
    const t = this.tasks.find((x) => x.id === id)
    if (!t) return
    if (t.state === 'running') t.state = 'paused'
    this.tasks = this.tasks.filter((x) => x.id !== id)
    this.notify()
  }

  setPriority(id: string, priority: number): void {
    const t = this.tasks.find((x) => x.id === id)
    if (t) { t.priority = priority; this.notify() }
  }

  list(): DownloadTask[] { return this.tasks.map((t) => ({ ...t })) }

  waitIdle(): Promise<void> {
    if (!this.tasks.some((t) => t.state === 'queued' || t.state === 'running')) return Promise.resolve()
    return new Promise((r) => this.waiters.push(r))
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/download-manager.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/download-manager.ts tests/download-manager.test.ts
git commit -m "feat(downloads): queue manager with priority, pause/resume, resume-from-disk"
```

---

### Task 6: DownloadManager IPC + экран Downloads

**Files:**
- Modify: `src/main/index.ts` (инстанс + IPC-хендлеры)
- Modify: `src/shared/ipc.ts` (каналы + типы Api)
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/screens/Downloads.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx` (пункт меню)
- Modify: `src/renderer/src/state/store.tsx` (Screen type)
- Modify: `src/renderer/src/styles.css` (стили списка загрузок)

**Interfaces:**
- Consumes: `DownloadManager` (Task 5), `resolveGallery` (Task 4).
- Produces: IPC `downloads:list/add/pause/resume/remove/setPriority`, событие `downloads:changed`, API `window.api.downloads*`, React-экран.

- [ ] **Step 1: ipc.ts — каналы и типы**

```ts
// в CH добавить:
downloadsList: 'downloads:list',
downloadsAdd: 'downloads:add',
downloadsPause: 'downloads:pause',
downloadsResume: 'downloads:resume',
downloadsRemove: 'downloads:remove',
downloadsSetPriority: 'downloads:setPriority',
downloadsChanged: 'downloads:changed',
// в Api добавить (DownloadTask тип переиспользуем из нового shared-файла):
downloadsList(): Promise<DownloadTask[]>
downloadsAdd(sourceUrl: string): Promise<DownloadTask | null>
downloadsPause(id: string): Promise<void>
downloadsResume(id: string): Promise<void>
downloadsRemove(id: string): Promise<void>
downloadsSetPriority(id: string, priority: number): Promise<void>
```

`DownloadTask` интерфейс перенести в `src/shared/downloads.ts` и импортировать из main-сервиса и renderer.

- [ ] **Step 2: main/index.ts — инстанс**

После `history = new HistoryManager()`:

```ts
import { DownloadManager } from './services/download-manager'
import { resolveGallery } from './services/resolve-gallery'

const downloads = new DownloadManager(
  join(app.getPath('userData'), 'downloads'),
  join(app.getPath('userData'), 'downloads.json'),
  {
    fetchBinary: (url, headers, proxy, timeoutMs) => httpFetchBinary(url, headers ?? {}, proxy, timeoutMs),
    broadcast: (tasks) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.downloadsChanged, tasks) }
  }
)

ipcMain.handle(CH.downloadsList, () => downloads.list())
ipcMain.handle(CH.downloadsAdd, async (_e, sourceUrl: string) => {
  const s = settings.get()
  const torSocks = s.tor_socks_addr || '127.0.0.1:9150'
  const isEx = sourceUrl.includes('exhentai') || sourceUrl.includes('e-hentai.org')
  const useTor = sourceUrl.includes('.onion') || (isEx && (s.tor_proxied_sites.includes('ehentai') || s.tor_proxied_sites.includes('exhentai')))
  const proxy = useTor ? torSocks : (isEx && s.exhentai_proxy_addr.trim() ? s.exhentai_proxy_addr.trim() : undefined)
  const cookieHeader = sourceUrl.includes('.onion') ? s.onion_cookies_raw : isEx ? exAccounts.currentCookieHeader() : undefined
  return await downloads.add(sourceUrl, () => resolveGallery(sourceUrl, { proxy, cookieHeader }), {
    Referer: sourceUrl,
    ...(cookieHeader ? { Cookie: cookieHeader } : {})
  }, proxy)
})
ipcMain.handle(CH.downloadsPause, (_e, id: string) => downloads.pause(id))
ipcMain.handle(CH.downloadsResume, (_e, id: string) => downloads.resume(id))
ipcMain.handle(CH.downloadsRemove, (_e, id: string) => downloads.remove(id))
ipcMain.handle(CH.downloadsSetPriority, (_e, id: string, p: number) => downloads.setPriority(id, p))
```

- [ ] **Step 3: preload + store + Sidebar**

`preload/index.ts`:

```ts
downloadsList: () => ipcRenderer.invoke(CH.downloadsList),
downloadsAdd: (sourceUrl) => ipcRenderer.invoke(CH.downloadsAdd, sourceUrl),
downloadsPause: (id) => ipcRenderer.invoke(CH.downloadsPause, id),
downloadsResume: (id) => ipcRenderer.invoke(CH.downloadsResume, id),
downloadsRemove: (id) => ipcRenderer.invoke(CH.downloadsRemove, id),
downloadsSetPriority: (id, p) => ipcRenderer.invoke(CH.downloadsSetPriority, id, p),
onDownloadsChanged: (cb) => { const fn = (_e: unknown, tasks: DownloadTask[]) => cb(tasks); ipcRenderer.on(CH.downloadsChanged, fn); return () => ipcRenderer.removeListener(CH.downloadsChanged, fn) },
onEhLimitsChanged: (cb) => { const fn = (_e: unknown, s: EhLimitState) => cb(s); ipcRenderer.on(CH.ehLimitsChanged, fn); return () => ipcRenderer.removeListener(CH.ehLimitsChanged, fn) }
```

`store.tsx`: `export type Screen = 'Reader' | 'Catalog' | 'History' | 'Downloads' | 'Settings'`.
`Sidebar.tsx`: добавить `{ key: 'Downloads', icon: '\u2B73', label: 'Downloads' }` после History.

- [ ] **Step 4: Downloads.tsx**

```tsx
import { useEffect, useState } from 'react'
import type { DownloadTask } from '@shared/downloads'

export default function Downloads(): JSX.Element {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  useEffect(() => {
    window.api.downloadsList().then(setTasks)
    return window.api.onDownloadsChanged(setTasks)
  }, [])
  return (
    <div className="screen downloads">
      <h3>Downloads</h3>
      {tasks.length === 0 && <div className="muted">Нет загрузок</div>}
      {tasks.map((t) => (
        <div key={t.id} className="dl-row">
          <span className="dl-title">{t.title}</span>
          <progress max={t.totalPages} value={t.completedPages.length} />
          <span className="muted">{t.completedPages.length}/{t.totalPages}</span>
          <span className="muted">{t.state}{t.error ? `: ${t.error}` : ''}</span>
          {t.state === 'running' && <button onClick={() => void window.api.downloadsPause(t.id)}>Pause</button>}
          {(t.state === 'paused' || t.state === 'error') && <button onClick={() => void window.api.downloadsResume(t.id)}>Resume</button>}
          <button onClick={() => void window.api.downloadsSetPriority(t.id, t.priority === 10 ? 0 : 10)}>{t.priority > 0 ? '↓prio' : '↑prio'}</button>
          <button onClick={() => void window.api.downloadsRemove(t.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}
```

В `App.tsx` подключить: `{screen === 'Downloads' && <Downloads />}`.

- [ ] **Step 5: styles.css**

```css
.dl-row { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid #222; }
.dl-row progress { width: 140px; }
.dl-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 6: typecheck + tests + commit**

Run: `npm run typecheck && npm test`
Expected: PASS

```bash
git add -A
git commit -m "feat(downloads): IPC + Downloads screen with pause/resume/priority"
```

---

### Task 7: Открытие скачанных галерей + синхронизация обновлений

**Files:**
- Modify: `src/shared/ipc.ts` (`downloadsOpen`, `downloadsCheckUpdates`)
- Modify: `src/main/services/download-manager.ts` (`checkUpdates`)
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/screens/Downloads.tsx` (кнопки Open/Check updates)
- Test: `tests/download-update.test.ts`

**Interfaces:**
- Consumes: `DownloadManager` (Task 5), `resolveGallery` (Task 4), `parseMangaPageUrl`-стиль локального открытия (`galleries` Map в index.ts уже хранит локальные галереи — переиспользуем `galleryFromFolder`-паттерн).
- Produces: `DownloadManager.checkUpdates(urls: string[], resolve: (url) => Promise<GalleryResolution | null>): Promise<string[]>` (возвращает id задач, получивших update-available → докачка), IPC `downloads:open(id)` → возвращает `OpenFolderResult`-подобный объект, `downloads:checkUpdates`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DownloadManager } from '../src/main/services/download-manager'

describe('update sync', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dlupd-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('appends new pages when page count grows', async () => {
    let urls = ['u1', 'u2']
    const m = new DownloadManager(join(dir, 'dl'), join(dir, 'd.json'), {
      fetchBinary: async () => new Uint8Array([1]),
      broadcast: () => {}
    })
    const t = await m.add('https://x/g/1/', async () => ({
      title: 'T', pageUrls: urls, coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's'
    }), {})
    await m.waitIdle()
    expect(t!.state).toBe('completed')
    urls = ['u1', 'u2', 'u3', 'u4']
    const updated = await m.checkUpdates(['https://x/g/1/'], async () => ({
      title: 'T', pageUrls: urls, coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's'
    }))
    expect(updated).toContain(t!.id)
    await m.waitIdle()
    expect(t!.pageUrls).toHaveLength(4)
    expect(t!.state).toBe('completed')
  })

  it('no update when count unchanged', async () => {
    const m = new DownloadManager(join(dir, 'dl'), join(dir, 'd.json'), {
      fetchBinary: async () => new Uint8Array([1]),
      broadcast: () => {}
    })
    await m.add('https://x/g/1/', async () => ({
      title: 'T', pageUrls: ['u1'], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's'
    }), {})
    await m.waitIdle()
    const updated = await m.checkUpdates(['https://x/g/1/'], async () => ({
      title: 'T', pageUrls: ['u1'], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's'
    }))
    expect(updated).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/download-update.test.ts`
Expected: FAIL — checkUpdates is not a function.

- [ ] **Step 3: Implement checkUpdates в DownloadManager**

```ts
async checkUpdates(urls: string[], resolve: (url: string) => Promise<GalleryResolution | null>): Promise<string[]> {
  const updated: string[] = []
  for (const url of urls) {
    const t = this.tasks.find((x) => x.sourceUrl === url && x.state === 'completed')
    if (!t) continue
    try {
      const res = await resolve(url)
      if (!res) continue
      if (res.pageUrls.length <= t.pageUrls.length) continue
      t.pageUrls = res.pageUrls
      t.totalPages = res.pageUrls.length
      t.state = 'queued'
      updated.push(t.id)
      void this.pump()
    } catch { /* сеть/лимиты — пропускаем */ }
  }
  if (updated.length > 0) this.notify()
  return updated
}
```

IPC `CH.downloadsCheckUpdates = 'downloads:checkUpdates'` → handler: `await downloads.checkUpdates(downloads.list().filter(t => t.state === 'completed').map(t => t.sourceUrl), (url) => resolveGallery(url, {...те же opts...}))`.

IPC `CH.downloadsOpen = 'downloads:open'` → handler в index.ts:

```ts
ipcMain.handle(CH.downloadsOpen, (_e, id: string) => {
  const t = downloads.list().find((x) => x.id === id)
  if (!t || t.state !== 'completed') return null
  const g = galleryFromFolder(t.outDir)
  if (!g) return null
  galleries.set(g.id, g)
  return { id: g.id, title: g.title, pageCount: g.pages.length, pages: g.pages, url: `file://${t.outDir}` }
})
```

Downloads.tsx: для completed добавить кнопки `Open` (store: `setOpened({ kind: 'local', ...r, startPage: 0 })`) и общий тулбар `Check updates`.

- [ ] **Step 4: Run test + typecheck + commit**

Run: `npx vitest run tests/download-update.test.ts && npm run typecheck && npm test`
Expected: PASS

```bash
git add -A
git commit -m "feat(downloads): open downloaded gallery + update sync via checkUpdates"
```

---

### Task 8: Локальные zip/cbz через yauzl

**Files:**
- Create: `src/main/services/zip-gallery.ts`
- Modify: `src/main/index.ts` (pickFolder/openFolder — фильтр .zip/.cbz, маршрутизация)
- Modify: `src/shared/ipc.ts` (OpenResult уже покрывает)
- Test: `tests/zip-gallery.test.ts`

**Interfaces:**
- Consumes: yauzl ^3.4.0, `naturalSort` (natural-sort.ts).
- Produces:

```ts
export interface ZipGalleryInfo { id: string; title: string; pageCount: number; entries: string[] }
export function isZipPath(p: string): boolean
export async function openZipGallery(zipPath: string, tmpBase: string): Promise<ZipGalleryInfo | null>  // читает Central Directory, natural-sort, id = sha1(path)
export function readZipEntry(zipPath: string, entryName: string, tmpBase: string): Promise<string>  // извлекает в tmpBase/<zipHash>/, возвращает путь к файлу (кэш)
export function clearZipTmp(tmpBase: string, zipId: string): void
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'
import { isZipPath, openZipGallery, readZipEntry } from '../src/main/services/zip-gallery'

// powershell Compress-Archive создаёт zip без внешних зависимостей
function makeTestZip(zipPath: string, files: Record<string, Buffer>): void {
  const staging = join(zipPath, '..', 'staging-zip')
  rmSync(staging, { recursive: true, force: true })
  for (const [name, content] of Object.entries(files)) {
    const p = join(staging, name)
    writeFileSync(p, content)
  }
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${staging}\\*' -DestinationPath '${zipPath}' -Force"`)
  rmSync(staging, { recursive: true, force: true })
}

describe('zip-gallery', () => {
  let dir: string
  let tmp: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zip-')); tmp = join(dir, 'tmp') })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('isZipPath', () => {
    expect(isZipPath('a.ZIP')).toBe(true)
    expect(isZipPath('a.cbz')).toBe(true)
    expect(isZipPath('a.jpg')).toBe(false)
  })

  it('opens zip and sorts entries naturally', async () => {
    const zip = join(dir, 'test.zip')
    makeTestZip(zip, { '2.jpg': Buffer.from([2]), '10.jpg': Buffer.from([10]), '1.jpg': Buffer.from([1]) })
    const g = await openZipGallery(zip, tmp)
    expect(g).not.toBeNull()
    expect(g!.pageCount).toBe(3)
    const names = g!.entries.map((e) => e.split(/[\\/]/).pop()!)
    expect(names.indexOf('10.jpg')).toBeGreaterThan(names.indexOf('2.jpg'))
    expect(names.indexOf('1.jpg')).toBeLessThan(names.indexOf('2.jpg'))
  })

  it('reads entry lazily into tmp cache', async () => {
    const zip = join(dir, 'test.zip')
    makeTestZip(zip, { '1.jpg': Buffer.from([1, 2, 3]) })
    const g = await openZipGallery(zip, tmp)
    const p = await readZipEntry(zip, g!.entries[0], tmp)
    expect(existsSync(p)).toBe(true)
    const p2 = await readZipEntry(zip, g!.entries[0], tmp)
    expect(p2).toBe(p) // cached
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/zip-gallery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Install yauzl + write implementation**

```bash
npm install yauzl @types/yauzl
```

`src/main/services/zip-gallery.ts`:

```ts
import yauzl from 'yauzl'
import { createHash } from 'crypto'
import { mkdirSync, existsSync, createWriteStream } from 'fs'
import { join } from 'path'
import { naturalSort } from './natural-sort'

const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i

export function isZipPath(p: string): boolean {
  return /\.(zip|cbz)$/i.test(p)
}

function zipId(zipPath: string): string {
  return createHash('sha1').update(zipPath.toLowerCase()).digest('hex').slice(0, 12)
}

export interface ZipGalleryInfo {
  id: string
  title: string
  pageCount: number
  entries: string[]
}

const entriesCache = new Map<string, string[]>()

function listEntries(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return reject(err ?? new Error('cannot open zip'))
      const out: string[] = []
      zf.on('entry', (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith('/') && IMAGE_RE.test(entry.fileName)) out.push(entry.fileName)
        zf.readEntry()
      })
      zf.on('end', () => { zf.close(); resolve(out) })
      zf.on('error', reject)
      zf.readEntry()
    })
  })
}

export async function openZipGallery(zipPath: string, tmpBase: string): Promise<ZipGalleryInfo | null> {
  const entries = await listEntries(zipPath)
  if (entries.length === 0) return null
  const id = zipId(zipPath)
  entriesCache.set(id, entries)
  const title = zipPath.split(/[\\/]/).pop()?.replace(/\.(zip|cbz)$/i, '') ?? 'Archive'
  return { id, title, pageCount: entries.length, entries }
}

export function readZipEntry(zipPath: string, entryName: string, tmpBase: string): Promise<string> {
  const id = zipId(zipPath)
  const dest = join(tmpBase, id, entryName.replace(/[\\/]/g, '__'))
  if (existsSync(dest)) return Promise.resolve(dest)
  mkdirSync(join(dest, '..'), { recursive: true })
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return reject(err ?? new Error('cannot open zip'))
      let found = false
      zf.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== entryName) { zf.readEntry(); return }
        found = true
        zf.openReadStream(entry, (err2, stream) => {
          if (err2 || !stream) { zf.close(); return reject(err2 ?? new Error('no stream')) }
          const ws = createWriteStream(dest)
          stream.pipe(ws)
          ws.on('close', () => { zf.close(); resolve(dest) })
          ws.on('error', reject)
        })
      })
      zf.on('end', () => { zf.close(); if (!found) reject(new Error('entry not found')) })
      zf.on('error', reject)
      zf.readEntry()
    })
  })
}

export function clearZipTmp(tmpBase: string, zipId: string): void {
  rmSync(join(tmpBase, zipId), { recursive: true, force: true })
}
```

- [ ] **Step 4: Интеграция в index.ts**

В `protocol.handle('manga', ...)` перед локальной веткой `galleries.get(gid)`:

```ts
import { openZipGallery, readZipEntry, isZipPath, clearZipTmp } from './services/zip-gallery'

const zipMeta = new Map<string, { zipPath: string; entries: string[] }>()
const ZIP_TMP = join(app.getPath('userData'), 'tmp', 'zip')

// при pickFolder/openFolder: если путь — файл с .zip/.cbz →
const zi = await openZipGallery(path, ZIP_TMP)
if (zi) {
  zipMeta.set(zi.id, { zipPath: path, entries: zi.entries })
  return { id: zi.id, title: zi.title, pageCount: zi.pageCount, pages: zi.entries, url: `file://${path}` }
}
```

В protocol.handle, ветка `if (zipMeta.has(gid))`:

```ts
const zm = zipMeta.get(gid)!
if (index < 0 || index >= zm.entries.length) return new Response('Not found', { status: 404 })
const file = await readZipEntry(zm.zipPath, zm.entries[index], ZIP_TMP)
return net.fetch(pathToFileURL(file).toString())
```

Диалог `dialog.showOpenDialog` в pickFolder: добавить `filters: [{ name: 'Gallery', extensions: [] }]` (папки остаются; zip-файлы выбираются отдельной кнопкой в Reader или тем же диалогом с `properties: ['openDirectory', 'openFile']`).

- [ ] **Step 5: Run test + typecheck + commit**

Run: `npx vitest run tests/zip-gallery.test.ts && npm run typecheck && npm test`
Expected: PASS

```bash
git add -A
git commit -m "feat(zip): lazy zip/cbz galleries via yauzl with tmp cache"
```

---

### Task 9: EH-архивы (archiver.php)

**Files:**
- Create: `src/main/services/eh-archive.ts`
- Modify: `src/main/index.ts` (IPC), `src/shared/ipc.ts`
- Modify: `src/renderer/src/components/BookView.tsx` / Reader toolbar (кнопка для EH)
- Test: `tests/eh-archive.test.ts`

**Interfaces:**
- Consumes: `httpFetch` (http.ts), `resolveGallery`-куки.
- Produces:

```ts
export interface ArchiveCost { costGp: number | null; options: { key: string; label: string }[]; archiverUrl: string }
export function parseArchiverPage(html: string): ArchiveCost | null
export async function fetchArchiveCost(url: string, opts: { cookieHeader?: string; proxy?: string }): Promise<ArchiveCost | null>
export async function buyArchive(url: string, opts: { cookieHeader?: string; proxy?: string; formPost?: boolean }): Promise<{ downloadUrl: string } | null>
```

- [ ] **Step 1: Write the failing test** (фикстура HTML страницы archiver)

`tests/fixtures/eh-archiver.html` — минимальный HTML:

```html
<html><body>
<div id="dbx">Archive Download</div>
<form method="post" action="https://exhentai.org/archiver.php?gid=1&amp;token=abc">
  <div>Cost: 100 GP</div>
  <input type="radio" name="dltype" value="org" checked> Original Archive
  <input type="radio" name="dltype" value="res"> Resampled
  <input type="submit" name="dlcheck" value="Download">
</form>
</body></html>
```

Тест:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseArchiverPage } from '../src/main/services/eh-archive'

const html = readFileSync(join('tests', 'fixtures', 'eh-archiver.html'), 'utf-8')

describe('parseArchiverPage', () => {
  it('parses cost and options', () => {
    const r = parseArchiverPage(html)
    expect(r).not.toBeNull()
    expect(r!.costGp).toBe(100)
    expect(r!.options.map((o) => o.key)).toEqual(['org', 'res'])
    expect(r!.archiverUrl).toContain('archiver.php')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eh-archive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementation**

```ts
import * as cheerio from 'cheerio'
import { httpFetch } from './http'

export interface ArchiveCost {
  costGp: number | null
  options: { key: string; label: string }[]
  archiverUrl: string
}

export function parseArchiverPage(html: string): ArchiveCost | null {
  if (html.includes('You have exceeded your usage limit') || html.trim() === '') return null
  const $ = cheerio.load(html)
  const form = $('form[action*="archiver"]').first()
  if (form.length === 0) return null
  const archiverUrl = form.attr('action') ?? ''
  const text = form.text()
  const m = text.match(/(\d+)\s*GP/i)
  const options = form.find('input[type=radio][name=dltype]').toArray().map((el) => ({
    key: $(el).attr('value') ?? '',
    label: $(el).parent().text().replace(/\s+/g, ' ').trim() || ($(el).attr('value') ?? '')
  }))
  return { costGp: m ? Number(m[1]) : null, options, archiverUrl }
}

export async function fetchArchiveCost(
  url: string,
  opts: { cookieHeader?: string; proxy?: string }
): Promise<ArchiveCost | null> {
  const r = await httpFetch({ url, headers: { Referer: url, ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {}) } }, opts.proxy)
  return parseArchiverPage(r.text)
}

export async function buyArchive(
  url: string,
  opts: { cookieHeader?: string; proxy?: string; dltype?: string }
): Promise<{ downloadUrl: string } | null> {
  const r = await httpFetch({
    url,
    method: 'POST',
    body: `dltype=${encodeURIComponent(opts.dltype ?? 'org')}&dlcheck=Download`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: url,
      ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {})
    }
  }, opts.proxy)
  // Response contains a link like /dl/<hash>/<gid>-<token>.zip or full URL
  const m = r.text.match(/https?:\/\/[^"'\s]+\.zip[^"'\s]*/)
  if (m) return { downloadUrl: m[0] }
  const m2 = r.text.match(/href="([^"]+\.zip[^"]*)"/)
  if (m2) return { downloadUrl: m2[1].startsWith('http') ? m2[1] : new URL(m2[1], url).toString() }
  return null
}
```

- [ ] **Step 4: IPC + UI**

`CH`: `ehArchiveCost: 'ehArchive:cost'`, `ehArchiveBuy: 'ehArchive:buy'`. Handlers в index.ts (куки как для clearnet Ex). `downloadsAdd` расширяется: если `pageUrls` пуст и есть `archiveDownloadUrl` → задача типа download-and-unpack (использует `readZipEntry`-распаковку через yauzl extract-all → outDir).

`DownloadManager.add` вариант для архива:

```ts
addArchive(sourceUrl: string, title: string, downloadUrl: string, headers: Record<string, string>, proxy?: string): Promise<DownloadTask | null>
```

В `runTask`: если `t.archiveDownloadUrl` → `fetchBinary(downloadUrl)` → временный .zip в outDir → yauzl extract-all → удалить zip → completed.

UI: в Reader toolbar, если `opened.source` содержит 'ExHentai'/'E-Hentai' → кнопка `⬇ Archive` → диалог: показываем `costGp`, выбор dltype, подтверждение → `window.api.ehArchiveBuy(url, { dltype })` → `downloads.addArchive(...)` → тост «Архив куплен, скачивается в Downloads».

- [ ] **Step 5: Run test + typecheck + commit**

Run: `npx vitest run tests/eh-archive.test.ts && npm run typecheck && npm test`
Expected: PASS

```bash
git add -A
git commit -m "feat(eh-archive): cost parsing, purchase flow, download-and-unpack task"
```

---

### Task 10: Восстановление позиции чтения

**Files:**
- Modify: `src/renderer/src/screens/Reader.tsx:122-137` (openUrl использует read_progress), `:108-111` (openFolder), History card (кнопка Continue уже есть — проверить)
- Modify: `src/renderer/src/screens/Downloads.tsx` (Open использует startPage)
- Test: ручной + unit на чистой функции

**Interfaces:**
- Consumes: `settings.read_progress: Record<string, [number, number]>` (уже в Settings).
- Produces: чистая функция `startPageFor(url: string, readProgress: Record<string, [number, number]>): number` в `src/shared/settings.ts`.

- [ ] **Step 1: Add pure function + test**

В `src/shared/settings.ts`:

```ts
export function startPageFor(url: string, readProgress: Record<string, [number, number]>): number {
  const p = readProgress[url]
  if (!p || !Array.isArray(p)) return 0
  const [page, total] = p
  if (total > 0 && page >= total) return 0
  return Math.max(0, page - 1)
}
```

В `tests/settings.test.ts` добавить:

```ts
import { startPageFor } from '../src/shared/settings'
describe('startPageFor', () => {
  it('returns saved page - 1', () => {
    expect(startPageFor('u', { u: [5, 10] })).toBe(4)
  })
  it('returns 0 for finished gallery', () => {
    expect(startPageFor('u', { u: [10, 10] })).toBe(0)
  })
  it('returns 0 when unknown', () => {
    expect(startPageFor('x', {})).toBe(0)
  })
})
```

- [ ] **Step 2: Использовать в Reader.tsx openUrl**

```ts
const openUrl = useCallback(async () => {
  const url = urlText.trim()
  if (!url) return
  setOpeningUrl(true)
  try {
    const saved = startPageFor(url, settings.read_progress)
    const r = await window.api.openUrl(url, saved)
    if (r) {
      setOpened({ kind: 'online', ...r, startPage: saved })
      setUrlText('')
    } else {
      alert('Не удалось открыть URL')
    }
  } finally {
    setOpeningUrl(false)
  }
}, [urlText, settings.read_progress, setOpened])
```

Аналогично `openChapter` и кнопка Open в Downloads: `startPage: startPageFor(r.url, settings.read_progress)`.

- [ ] **Step 3: Run tests + typecheck + commit**

Run: `npm test && npm run typecheck`
Expected: PASS

```bash
git add -A
git commit -m "feat(reader): restore reading position from read_progress on open"
```

---

### Task 11: PIN-лок

**Files:**
- Create: `src/main/services/pin.ts`
- Modify: `src/shared/ipc.ts` (`pin:hasPin/setPin/removePin/verifyPin`)
- Modify: `src/main/index.ts` (handlers)
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/components/LockScreen.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/screens/Settings.tsx` (секция Security)
- Test: `tests/pin.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:

```ts
export interface PinStore { salt: string; hash: string }
export function makePinRecord(pin: string, salt: string): PinStore
export function verifyPin(record: PinStore, pin: string): boolean
export class PinService {
  constructor(userDataDir: string)
  hasPin(): boolean
  setPin(pin: string): void       // 4-8 цифр, throws при неверном формате
  removePin(pin: string): boolean // требует текущий pin
  verify(pin: string): boolean
  failedAttempt(): { locked: boolean; retryAfterSec: number }  // 3 ошибки → 30s задержка
}
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { makePinRecord, verifyPin, PinService } from '../src/main/services/pin'

describe('pin', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pin-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('makePinRecord verifies correct, rejects wrong', () => {
    const rec = makePinRecord('1234', 'salt')
    expect(verifyPin(rec, '1234')).toBe(true)
    expect(verifyPin(rec, '9999')).toBe(false)
  })

  it('PinService persists and verifies', () => {
    const s = new PinService(dir)
    expect(s.hasPin()).toBe(false)
    s.setPin('1234')
    expect(s.hasPin()).toBe(true)
    const s2 = new PinService(dir)
    expect(s2.verify('1234')).toBe(true)
    expect(s2.verify('0000')).toBe(false)
    expect(s2.removePin('0000')).toBe(false)
    expect(s2.removePin('1234')).toBe(true)
    expect(s2.hasPin()).toBe(false)
  })

  it('rejects bad pin format', () => {
    const s = new PinService(dir)
    expect(() => s.setPin('12')).toThrow()
    expect(() => s.setPin('abcd')).toThrow()
  })

  it('lockout after 3 failures', () => {
    const s = new PinService(dir)
    s.setPin('1234')
    s.failedAttempt(); s.failedAttempt()
    expect(s.failedAttempt().locked).toBe(false)
    const r = s.failedAttempt()
    expect(r.locked).toBe(true)
    expect(r.retryAfterSec).toBe(30)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementation**

```ts
import { createHash, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface PinStore { salt: string; hash: string }

export function makePinRecord(pin: string, salt: string): PinStore {
  return { salt, hash: createHash('sha256').update(salt + pin).digest('hex') }
}

export function verifyPin(record: PinStore, pin: string): boolean {
  return makePinRecord(pin, record.salt).hash === record.hash
}

const PIN_RE = /^\d{4,8}$/

export class PinService {
  private path: string
  private fails = 0
  private lockUntil = 0

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'pin.json')
  }

  private load(): PinStore | null {
    if (!existsSync(this.path)) return null
    try { return JSON.parse(readFileSync(this.path, 'utf-8')) as PinStore } catch { return null }
  }

  hasPin(): boolean { return this.load() !== null }

  setPin(pin: string): void {
    if (!PIN_RE.test(pin)) throw new Error('PIN должен быть 4–8 цифр')
    writeFileSync(this.path, JSON.stringify(makePinRecord(pin, randomBytes(16).toString('hex')), null, 2))
    this.fails = 0
    this.lockUntil = 0
  }

  removePin(pin: string): boolean {
    const rec = this.load()
    if (!rec || !verifyPin(rec, pin)) return false
    try { rmSync(this.path) } catch { /* ignore */ }
    return true
  }

  verify(pin: string): boolean {
    const rec = this.load()
    if (!rec) return true // no pin set
    if (Date.now() < this.lockUntil) return false
    const ok = verifyPin(rec, pin)
    if (ok) { this.fails = 0; this.lockUntil = 0 }
    return ok
  }

  failedAttempt(): { locked: boolean; retryAfterSec: number } {
    this.fails++
    if (this.fails >= 3) {
      this.lockUntil = Date.now() + 30_000
      this.fails = 0
      return { locked: true, retryAfterSec: 30 }
    }
    return { locked: false, retryAfterSec: 0 }
  }
}
```

Примечание: добавить `import { rmSync } from 'fs'` в реализацию выше.

- [ ] **Step 4: IPC + LockScreen + Settings**

`CH`: `pinHasPin: 'pin:hasPin'`, `pinSetPin: 'pin:setPin'`, `pinRemovePin: 'pin:removePin'`, `pinVerifyPin: 'pin:verifyPin'`.

Handlers:

```ts
const pin = new PinService(app.getPath('userData'))
ipcMain.handle(CH.pinHasPin, () => pin.hasPin())
ipcMain.handle(CH.pinSetPin, (_e, p: string) => pin.setPin(String(p)))
ipcMain.handle(CH.pinRemovePin, (_e, p: string) => pin.removePin(String(p)))
ipcMain.handle(CH.pinVerifyPin, (_e, p: string) => pin.verify(String(p)))
```

`LockScreen.tsx`:

```tsx
import { useState } from 'react'

export default function LockScreen({ onUnlock }: { onUnlock: () => void }): JSX.Element {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)

  const tryPin = async (): Promise<void> => {
    if (locked) return
    const ok = await window.api.pinVerifyPin(pin)
    if (ok) { onUnlock(); return }
    const r = await window.api.pinFailedAttempt() // добавить в Api: возвращает { locked, retryAfterSec }
    if (r.locked) { setLocked(true); setTimeout(() => setLocked(false), r.retryAfterSec * 1000) }
    setError('Неверный PIN')
    setPin('')
  }

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <h3>PIN</h3>
        <input
          type="password" inputMode="numeric" autoFocus
          value={pin} onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void tryPin() }}
          disabled={locked}
          maxLength={8}
        />
        {error && <div className="lock-error">{error}</div>}
        {locked && <div className="lock-error">Слишком много попыток — подожди 30 c</div>}
        <button disabled={locked} onClick={() => void tryPin()}>Unlock</button>
      </div>
    </div>
  )
}
```

В Api добавить `pinFailedAttempt(): Promise<{ locked: boolean; retryAfterSec: number }>` и handler `pinFailedAttempt: () => pin.failedAttempt()`.

`App.tsx`:

```tsx
export default function App(): JSX.Element {
  const [unlocked, setUnlocked] = useState<boolean | null>(null)
  useEffect(() => {
    window.api.pinHasPin().then((has) => setUnlocked(!has))
  }, [])
  if (unlocked === null) return <div className="app" />
  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />
  return <StoreProvider><Shell /></StoreProvider>
}
```

Settings.tsx — секция Security: поле нового PIN, кнопка Set (требует текущий PIN при замене — используем `pinRemovePin(current)` затем `pinSetPin(new)`), кнопка Remove.

- [ ] **Step 5: Run test + typecheck + commit**

Run: `npx vitest run tests/pin.test.ts && npm run typecheck && npm test`
Expected: PASS

```bash
git add -A
git commit -m "feat(security): PIN lock screen with lockout, stored as salted hash"
```

---

### Task 12: Domain fronting — актуализация HOST2IPS

**Files:**
- Modify: `src/main/services/domain-fronting.ts`
- Test: существующий `tests/domain-fronting.test.ts` дополнить

**Interfaces:**
- Consumes: актуальный список из JHenTai `network_setting.dart` (проверен 2026-09-13 — совпадает с текущим кодом).
- Produces: без изменений API.

- [ ] **Step 1: Сверка**

Текущий `HOST2IPS` в `domain-fronting.ts` идентичен JHenTai `host2IPs` (все 5 хостов совпадают). Изменений кода не требуется.

- [ ] **Step 2: Дополнить тест**

В `tests/domain-fronting.test.ts` добавить:

```ts
it('covers all five EH hosts', () => {
  for (const h of ['e-hentai.org', 'exhentai.org', 'upld.e-hentai.org', 'api.e-hentai.org', 'forums.e-hentai.org']) {
    expect(supportsFronting(h)).toBe(true)
  }
})
```

- [ ] **Step 3: Run tests + commit**

Run: `npx vitest run tests/domain-fronting.test.ts`
Expected: PASS

```bash
git add tests/domain-fronting.test.ts
git commit -m "test(fronting): assert all five EH hosts covered (parity with JHenTai)"
```

---

### Task 13: Финальная проверка

**Files:** — (только проверки)

**Interfaces:** —

- [ ] **Step 1: Полная проверка**

Run: `npm run typecheck && npm test`
Expected: PASS, 0 failing.

- [ ] **Step 2: Smoke dev-запуск**

Run: `npm run dev` (вручную проверить: PIN-экран, Downloads экран, открытие zip из Reader).

- [ ] **Step 3: Финальный коммит (если остались изменения)**

```bash
git status --short
git add -A
git commit -m "chore: final adjustments after 7-feature implementation"
```
