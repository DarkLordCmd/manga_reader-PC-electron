# MangaNet-derived Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать 6 фич из разбора MangaNet: разделение catalog-search, headless-BrowserWindow-канал с анти-детектом, источники Grouple и MangaMello, зеркала картинок Lib, watchdog вёрстки — по спеке `docs/superpowers/specs/2026-09-13-manganet-derived-features-design.md`.

**Architecture:** Все новые runtime-возможности в main-процессе (`src/main/services/`): переиспользуемое скрытое BrowserWindow для JS-рендеринга страниц, HTTP-first-gate с browser-fallback, новые HTML/JSON-парсеры в `src/main/services/sources/` после рефакторинга. Renderer меняется минимально (списки источников + настройки зеркал).

**Tech Stack:** TypeScript, Electron 33 (BrowserWindow/webRequest/executeJavaScript), React 18, cheerio, vitest.

## Global Constraints

- Вся сеть/окна — только в main-процессе; renderer — только через типизированный IPC.
- Существующие поведение `catalog:search` НЕ меняется: фасад `catalog-search.ts` сохраняет все экспорты (это контракт, на который ссылаются тесты и index.ts).
- Русские пользовательские сообщения.
- Тесты в `tests/`, vitest, node environment; HTTP-фикстуры в `tests/fixtures/`.
- Каждый таск завершается зелёным `npm run typecheck && npm test` и коммитом.
- Новые runtime-строки в main-файлах: только через `httpFetch`/`httpFetchBinary` или browser-fetch, никаких прямых `fetch` в парсерах.

---

### Task 1: layout-watcher — watchdog вёрстки

**Files:**
- Create: `src/main/services/layout-watcher.ts`
- Test: `tests/layout-watcher.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces (используют Tasks 4, 5, 8, 9, 10):

```ts
export interface LayoutChangeError extends Error {
  code: 'layout-changed'
  pageHash: string   // первые 8 hex символов sha256(html)
  sourceName: string
  htmlHead: string   // первые 300 символов html
}
export function assertLayout(markers: string[], html: string, sourceName: string): void
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { assertLayout, type LayoutChangeError } from '../src/main/services/layout-watcher'

const html = '<html><body><div class="media-shell">x</div></body></html>'
const expectedHash = createHash('sha256').update(html).digest('hex').slice(0, 8)

describe('assertLayout', () => {
  it('passes when any marker is present', () => {
    expect(() => assertLayout(['.media-shell', 'nothing-else'], '<div class="media-shell">ok</div>', 'Manga-shi')).not.toThrow()
  })
  it('throws LayoutChangeError with hash when no marker found', () => {
    let err: LayoutChangeError | null = null
    try {
      assertLayout(['.media-shell', '.other-marker'], html, 'Manga-shi')
    } catch (e: any) {
      err = e
    }
    expect(err).not.toBeNull()
    expect(err!.code).toBe('layout-changed')
    expect(err!.pageHash).toBe(expectedHash)
    expect(err!.sourceName).toBe('Manga-shi')
    expect(err!.htmlHead).toBe(html.slice(0, 300))
    expect(err!.message).toContain('Manga-shi')
    expect(err!.message).toContain(expectedHash)
    expect(err!.message).toContain('Пришли разработчику')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/layout-watcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { createHash } from 'crypto'

export interface LayoutChangeError extends Error {
  code: 'layout-changed'
  pageHash: string
  sourceName: string
  htmlHead: string
}

export function assertLayout(markers: string[], html: string, sourceName: string): void {
  for (const m of markers) {
    if (html.includes(m)) return
  }
  const pageHash = createHash('sha256').update(html).digest('hex').slice(0, 8)
  const htmlHead = html.slice(0, 300)
  const e: LayoutChangeError = Object.assign(
    new Error(
      `Парсер ${sourceName} сломался: сайт поменял вёрстку (page hash ${pageHash}). ` +
      'Пришли разработчику этот хеш.'
    ),
    { code: 'layout-changed' as const, pageHash, sourceName, htmlHead }
  )
  throw e
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/layout-watcher.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/layout-watcher.ts tests/layout-watcher.test.ts
git commit -m "feat(layout-watcher): detect parser breakage with page hash"
```

---

### Task 2: Разделение catalog-search.ts на sources/

Перестановка кода 1:1 — функции переносятся дословно, меняются только импорты. Ничего нового не добавляется (кроме `exports` между файлами). Новые фичи (Grouple/MangaMello/зеркала) пишутся в последующих тасках уже в новые файлы.

**Files:**
- Create: `src/main/services/sources/catalog-types.ts`, `simple-sites.ts`, `eh.ts`, `remanga.ts`, `senkuro.ts`, `mangashi.ts`, `nhentai.ts`
- Create: `src/main/services/sources/index.ts` (facade)
- Delete: `src/main/services/sources.ts`(старый, после переноса — его содержимое уезжает в remanga.ts/senkuro.ts)
- Replace: `src/main/services/catalog-search.ts` → тонкий re-export фасад
- Modify: `src/main/index.ts`, `src/main/services/resolve-gallery.ts`, `src/main/services/simple-gallery.ts`, `src/renderer/src/env.d.ts` / типы (только где импортируют catalog-search/sources)
- Test: существующие `tests/catalog-search.test.ts`, `tests/simple-gallery.test.ts` остаются должны проходить БЕЗ правок (кроме импортов, если тест импортировал напрямую)

**Interfaces:**
- Produces: те же имена экспортов, теперь из `src/main/services/sources/*`:
  - `catalog-types.ts`: `CatalogItem`, `CatalogSourceKey`, `CatalogFilters`, `SimpleSiteConfig`, `siteKeyForUrl`, (internal) `resolve`, `UA`, `TOR_UA`
  - `simple-sites.ts`: `searchSimpleSite`
  - `eh.ts`: `ehErrorFromResponse`, `ExSearchResult`, `parseExHentaiListing`, `extractGid`, `extractGidToken`, `GDataResult`, `fetchGData`, `searchExHentai`, `looksRateLimited` (export для eh-limits совместимости)
  - `remanga.ts`: `mangaSeriesUrlFromChapterUrl`, `ChapterInfo`, `fetchRemangaChapters`, `fetchRemangaChapter`
  - `senkuro.ts`: `fetchSenkuroChapters`, `fetchSenkuroChapter`, `senkuroHeaders` (export)
  - `mangashi.ts`: `searchMangaShi`, `fetchMangaShiChapters`
  - `nhentai.ts`: `searchNhentai`, `parseNhentaiPageCount` (export)
- Facade `src/main/services/sources/index.ts`: re-export всех перечисленных имен.
- Facade `src/main/services/catalog-search.ts`:

```ts
export { CatalogItem, CatalogFilters, CatalogSourceKey, SimpleSiteConfig, siteKeyForUrl } from './sources/catalog-types'
export { searchSimpleSite } from './sources/simple-sites'
export { ehErrorFromResponse, parseExHentaiListing, extractGid, extractGidToken, fetchGData, searchExHentai, type ExSearchResult, type GDataResult, looksRateLimited } from './sources/eh'
export { searchMangaShi, fetchMangaShiChapters } from './sources/mangashi'
export { searchNhentai } from './sources/nhentai'
export type { CookieJar } from './cookies'
```

- `mangaSeriesUrlFromChapterUrl` расширяется: хосты `readmanga.`, `mintmanga.`, `mangapoisk.` тоже превращаются в series-url (`/manga/<slug>/`) — это понадобится Task 5; добавляется В ЭТОМ таске в `remanga.ts` (функция живёт там), тест ниже.

**Карты переносов (все функции переносятся verbatim):**
- из `catalog-search.ts:6-126` → `catalog-types.ts` (интерфейсы+siteKeyForUrl+UA/TOR_UA) и `simple-sites.ts` (searchSimpleSite + resolve)
- из `catalog-search.ts:128-406` → `eh.ts`
- из `catalog-search.ts:408-436` + `sources.ts:28-108` → `remanga.ts` (searchRemanga, fetchRemangaChapters, fetchRemangaChapter, mangaSeriesUrlFromChapterUrl, ChapterInfo)
- из `catalog-search.ts:438-479` + `sources.ts:110-197` → `senkuro.ts`
- из `catalog-search.ts:481-639` → `mangashi.ts`
- из `catalog-search.ts:641-707` → `nhentai.ts`
- `sources.ts` (старый файл) удаляется целиком; все импорты `{ ... } from './sources'`/`'./catalog-search'` в `index.ts`, `resolve-gallery.ts`, `simple-gallery.ts` остаются на тех же путях (фасады обеспечивают совместимость) — НО импорт `mangaSeriesUrlFromChapterUrl, fetchRemangaChapter, fetchSenkuroChapter` в `resolve-gallery.ts` продолжает работать через новый `sources/index.ts`; проверь, что путь `./sources` резолвится в `sources/index.ts` (да, по умолчанию).

- [ ] **Step 1: Мелкий тест на расширение series-url (красный)**

В `tests/catalog-search.test.ts` добавить:

```ts
import { mangaSeriesUrlFromChapterUrl } from '../src/main/services/sources'

describe('mangaSeriesUrlFromChapterUrl', () => {
  it('maps grouple chapter pages to series url', () => {
    expect(mangaSeriesUrlFromChapterUrl('https://readmanga.me/some-title/v1/')).toBe('https://readmanga.me/some-title/')
    expect(mangaSeriesUrlFromChapterUrl('https://mintmanga.com/another/v2/1')).toBe('https://mintmanga.com/another/')
    expect(mangaSeriesUrlFromChapterUrl('https://mangapoisk.me/x/v1/1')).toBe('https://mangapoisk.me/x/')
  })
})
```

Run: `npx vitest run tests/catalog-search.test.ts`
Expected: FAIL — exported member not found (или неправильный результат).

- [ ] **Step 2: Выполнить переносы и расширение функции**

В `remanga.ts` расширить:

```ts
export function mangaSeriesUrlFromChapterUrl(url: string): string | null {
  const lower = url.toLowerCase()
  if (!(lower.includes('manga-shi.') || lower.includes('remanga.') || lower.includes('senkuro.') || lower.includes('readmanga.') || lower.includes('mintmanga.') || lower.includes('mangapoisk.'))) return null
  // ... остальное тело без изменений (см. sources.ts:3-19)
}
```

- [ ] **Step 3: Run all tests + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS (все существующие тесты каталога через фасад).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: split catalog-search into per-source service files"
```

---

### Task 3: browser-fetch — hidden BrowserWindow канап+ анти-бот gate

**Files:**
- Create: `src/main/services/browser-fetch.ts`
- Test: `tests/browser-fetch.test.ts` (только pure-часть: детектор анти-бота; BrowserWindow — ручной smoke в плане_execution)

**Interfaces:**
- Consumes: electron (BrowserWindow, session), buildSocksDispatcher — НЕ используется (Chromium сам ходит через setProxy).
- Produces (используют Task 4-5):

```ts
export interface BrowserFetchResult { html: string }
export function detectsAntiBot(status: number, html: string): boolean  // pure
export async function fetchHtmlViaBrowser(url: string, opts?: { proxy?: string; timeoutMs?: number }): Promise<string>
export async function shutdownBrowserFetch(): Promise<void>  // вызов на app quit
```

- [ ] **Step 1: Write the failing test (pure gate)**

```ts
import { describe, it, expect } from 'vitest'
import { detectsAntiBot } from '../src/main/services/browser-fetch'

describe('detectsAntiBot', () => {
  it('flags cloudflare challenge markers', () => {
    expect(detectsAntiBot(403, '<title>Just a moment...</title>')).toBe(true)
    expect(detectsAntiBot(503, 'Checking your browser before accessing')).toBe(true)
    expect(detectsAntiBot(200, 'Cf-Mitigated: challenge')).toBe(true)
  })
  it('passes normal pages', () => {
    expect(detectsAntiBot(200, '<html><body><a href="/manga/x/">ok</a></body></html>')).toBe(false)
  })
  it('flags rate limits', () => {
    expect(detectsAntiBot(429, 'too many requests')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/browser-fetch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
import { BrowserWindow, session } from 'electron'

export interface BrowserFetchResult { html: string }

/** Detects anti-bot walls after an HTTP fetch attempt. */
export function detectsAntiBot(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true
  const lower = html.slice(0, 4000).toLowerCase()
  return ['just a moment', 'checking your browser', 'cf-mitigated: challenge', 'attention required|cloudflare'].some((m) => lower.includes(m.replace('\\|', '|')))
}

/** Stealth runtime hardening, the same pattern MangaNet uses: hide
 * navigator.webdriver, spoof permissions.query and Function.toString so
 * anti-bot fingerprints see a normal browser. */
const STEALTH_JS = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.__proto__.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);
  const nativeToString = Function.prototype.toString;
  Function.prototype.toString = function () {
    if (this === window.navigator.permissions.query) return 'function query() { [native code] }';
    return nativeToString.call(this);
  };
`

let win: BrowserWindow | null = null
let currentSession: Electron.Session | null = null

function ensureBrowser(proxy?: string): BrowserWindow {
  const proxyKey = proxy?.trim() ?? ''
  if (win && !win.isDestroyed() && currentSession?.getUserAgent() !== undefined) {
    // distinct proxy sessions are not supported by the single-window pool; the
    // browser channel is per-app, proxy is fixed for its lifetime in this MVP
    return win
  }
  if (proxyKey && currentSession) {
    void currentSession.setProxy({ proxyRules: proxyKey })
  }
  const ses = currentSession ?? session.defaultSession
  ses.webRequest.onBeforeRequest((details, cb) => {
    const type = details.resourceType
    const allow = ['document', 'stylesheet', 'script', 'xhr', 'other'].includes(type)
    cb({ cancel: !allow })
  })
  currentSession = ses
  win = new BrowserWindow({
    show: false, width: 1024, height: 768,
    webPreferences: {
      session: ses,
      javascript: true, images: false, webSecurity: true
    }
  })
  return win
}

export async function fetchHtmlViaBrowser(url: string, opts: { proxy?: string; timeoutMs?: number } = {}): Promise<string> {
  const w = ensureBrowser(opts.proxy)
  const timeout = opts.timeoutMs ?? 30_000
  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Не удалось загрузить страницу через встроенный браузер: таймаут'))
      void shutdownBrowserFetch()
    }, timeout)
    w.webContents.once('did-finish-load', async () => {
      try {
        await w.webContents.executeJavaScript(STEALTH_JS, true)
        await new Promise((r) => setTimeout(r, 2000)) // сетевой покой
        const html: string = await w.webContents.executeJavaScript('document.documentElement.outerHTML', true)
        clearTimeout(timer)
        resolve(html)
      } catch (e: any) {
        clearTimeout(timer)
        reject(new Error(`Не удалось загрузить страницу через встроенный браузер: ${e?.message ?? String(e)}`))
      }
    })
    w.webContents.once('did-fail-load', (_e, code, desc) => {
      clearTimeout(timer)
      reject(new Error(`Не удалось загрузить страницу через встроенный браузер: ${code} ${desc}`))
    })
    void w.loadURL(url)
  })
}

export async function shutdownBrowserFetch(): Promise<void> {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
  currentSession = null
}
```

Примечание для имплементера: `attention required|cloudflare` — здесь `detectsAntiBot` должен просто искать маркеры `attention required` и `cloudflare` (не regex) — исключи искусственное `\|`. Также строку `webPreferences.sessison: ses` + `setProxy` вызывать ДО создания окна (setProxy на defaultSession влияет на всё приложение — допустимо в main, но при наличии активного `exhentai_proxy_addr`-прокси это перенимается на все net.fetch — НЕ допусти: если	opts.proxy задан, использовать ВСЕГДА отдельную `session.fromPartition('persist:browserfetch')`, а не defaultSession).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/browser-fetch.test.ts && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 5: Ручной smoke (plan-executor закладывает коммит и после — ручная проверка при push/тесте)**

Проверка через dev-режим: `npm run dev` → открыть каталог Com-X → убедиться, что страница каталога грузится (HTTP) как раньше. (Smoke real-домены — за пределами CI.)

- [ ] **Step 6: Commit**

```bash
git add src/main/services/browser-fetch.ts tests/browser-fetch.test.ts
git commit -m "feat(browser-fetch): hidden BrowserWindow channel with stealth scripts and anti-bot gate"
```

---

### Task 4: Подключение anti-bot gate в существующие источники

**Files:**
- Create: `src/main/services/fetch-html.ts` (новая обёртка)
- Modify: `src/main/services/sources/simple-sites.ts` (searchSimpleSite), `sources/mangashi.ts` (searchMangaShi, fetchMangaShiChapters)
- Test: `tests/fetch-html.test.ts` (mock httpFetch + детект)

**Interfaces:**
- Consumes: `httpFetch` (http.ts), `fetchHtmlViaBrowser`, `detectsAntiBot` (Task 3), `assertLayout` (Task 1).
- Produces:

```ts
export async function fetchHtmlSmart(url: string, opts: { proxy?: string; cookieHeader?: string; timeoutMs?: number; useBrowser?: boolean }): Promise<string>
```
- Логика: `httpFetch(http)` → если статус/вёрстка выглядят анти-ботом (`detectsAntiBot(result.status, result.text)`) И `useBrowser !== false` → `fetchHtmlViaBrowser(url, { proxy })`; результат — строка HTML. Если браузер тоже падает → оригинальная ошибка http-пути.

- [ ] **Step 1: Write the failing test (пира-логика через mocked httpFetch)**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/main/services/browser-fetch', async () => {
  return {
    fetchHtmlViaBrowser: async () => '<html><body class="fixed">ok</body></html>',
    detectsAntiBot: (await vi.importActual<any>('../src/main/services/browser-fetch')).detectsAntiBot
  }
})

const htmlFail = vi.hoisted(() => ({
  httpFetch: vi.fn()
}))

vi.mock('../src/main/services/http', () => htmlFail)

import { fetchHtmlSmart } from '../src/main/services/fetch-html'
import { detectsAntiBot as realDetect } from '../src/main/services/browser-fetch'

describe('fetchHtmlSmart', () => {
  beforeEach(() => { htmlFail.httpFetch.mockReset() })
  it('returns http result when healthy', async () => {
    htmlFail.httpFetch.mockResolvedValue({ status: 200, text: '<html><body><div class="media-shell">cat</div></body></html>' })
    const html = await fetchHtmlSmart('https://x/', { useBrowser: false }) // useBrowser false просто детерминирует ветку
    expect(html).toContain('media-shell')
  })
  it('falls back to browser on cloudflare challenge', async () => {
    htmlFail.httpFetch.mockResolvedValue({ status: 403, text: 'Just a moment...' })
    const html = await fetchHtmlSmart('https://x/')
    expect(html).toContain('class="fixed"')
  })
})
```

(Имплементеру: тост «useBrowser: false» только отключаетaby тестируемую ветку; в продукте фетчи будут вызывать `fetchHtmlSmart(url, { proxy, cookieHeader })` без useBrowser.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fetch-html.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
import { httpFetch } from './http'
import { fetchHtmlViaBrowser, detectsAntiBot } from './browser-fetch'

export interface FetchHtmlOptions {
  proxy?: string
  cookieHeader?: string
  timeoutMs?: number
  /** внутренняя ручка для тестов: отключает browser fallback */
  useBrowser?: boolean
}

export async function fetchHtmlSmart(url: string, opts: FetchHtmlOptions = {}): Promise<string> {
  const headers: Record<string, string> = {
    Referer: url,
    Accept: 'text/html,application/xhtml+xml',
    ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {})
  }
  const r = await httpFetch({ url, headers, timeoutMs: opts.timeoutMs }, opts.proxy)
  if (!detectsAntiBot(r.status, r.text)) return r.text
  if (opts.useBrowser === false) throw new Error(`HTTP ${r.status}: анти-бот блокирует запрос`)
  return await fetchHtmlViaBrowser(url, { proxy: opts.proxy, timeoutMs: opts.timeoutMs })
}
```

- [ ] **Step 4: Интеграция в simple-sites и mangashi**

В `sources/simple-sites.ts` (searchSimpleSite): заменить вызов `httpFetch({...}, opts.proxy)` — на:

```ts
const r = { status: 200, text: await fetchHtmlSmart(target, { proxy: opts.proxy }) }
```

В `sources/mangashi.ts`: обоих местах (searchMangaShi и странные fetchMangaShiChapters page1/r) — заменить `httpFetch(...)`:

```ts
const text = await fetchHtmlSmart(mangaUrl, { proxy })
// status>=400 проверки сохраняются с допущением, что fetchHtmlSmart не бросил — см. ниже
```

Т.O. когда fetchHtmlSmart не кидает, статус 200 (внутри уже проверен детектор); парсеру остаётся только текст. Убрать проверки `r.status >= 400` → преобразовать: `const text = await fetchHtmlSmart(...)` и исключить `page1.status`, `r.status` (код: перенесенныеcession функции уже используют текст после fetchHtmlSmart).

- [ ] **Step 5: Run tests + typecheck + commit**

Run: `npx vitest run tests/fetch-html.test.ts tests/catalog-search.test.ts && npm run typecheck && npm test`
Expected: PASS

```bash
git add -A
git commit -m "feat(fetch-html): anti-bot gate with browser fallback wired into simple-sites and manga-shi"
```

---

### Task 5: Grouple источники (readmanga/mintmanga/mangapoisk)

**Files:**
- Create: `src/main/services/sources/grouple.ts`
- Test: `tests/grouple.test.ts`
- Fixture: `tests/fixtures/grouple-list.html`
- Modify: `src/main/index.ts` (searchCatalog-ветки), `src/main/services/resolve-gallery.ts` (ветка для тех же хостов), `src/renderer/src/screens/Catalog.tsx` (SOURCES entries), `src/shared/ipc.ts` `CatalogSourceKey` (расширение типа)

**Interfaces:**
- Consumes: `fetchHtmlSmart` (Task 4), `assertLayout` (Task 1), `CatalogItem`, `SimpleSiteConfig` (Task 2).
- Produces:

```ts
export const GROUPLE_SITES: SimpleSiteConfig[]   // readmanga.me, mintmanga.com, mangapoisk.me
export async function searchGrouple(cfg: SimpleSiteConfig, query: string, page?: number): Promise<CatalogItem[]>
```

- [ ] **Step 1: Create fixture + failing test**

`tests/fixtures/grouple-list.html` (по аналогии с реальной разметкой grouple, минимально):

```html
<html><body>
<div class="tiles row">
  <div class="tile col-6 col-md-4 col-lg-3">
    <a class="tile-link" href="https://readmanga.me/berserk-/"><img src="/img/cover1.jpg"><span class="text-center">Берсерк</span></a>
  </div>
  <div class="tile col-6 col-md-4 col-lg-3">
    <a class="tile-link" href="https://readmanga.me/deadman_wonderland_"><img src="/img/cover2.jpg"><span class="text-center">Страница мёртвой крови</span></a>
  </div>
</div>
</body></html>
```

`tests/grouple.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { searchGrouple, GROUPLE_SITES } from '../src/main/services/sources/grouple'
import type { CatalogItem } from '../src/main/services/sources/catalog-types'

const html = readFileSync(join('tests', 'fixtures', 'grouple-list.html'), 'utf-8')

describe('GROUPLE_SITES', () => {
  it('has readmanga/mintmanga/mangapoisk', () => {
    expect(GROUPLE_SITES.map((s) => s.name)).toEqual(['Readmanga', 'Mintmanga', 'Mangapoisk'])
    expect(GROUPLE_SITES[0].base).toBe('https://readmanga.me')
  })
})

describe('searchGrouple parse', () => {
  it('extracts tiles and covers', async () => {
    // searchGrouple принимает parse-callback для тестов
    const items: CatalogItem[] = await searchGrouple(GROUPLE_SITES[0], '', 0, (url) => {
      if (url === `${GROUPLE_SITES[0].base}/`) return Promise.resolve(html)
      throw new Error('unexpected ' + url)
    })
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('Берсерк')
    expect(items[0].url).toBe('https://readmanga.me/berserk-/')
    expect(items[0].coverUrl).toBe('https://readmanga.me/img/cover1.jpg')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/grouple.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
import * as cheerio from 'cheerio'
import { fetchHtmlSmart } from '../fetch-html'
import { assertLayout } from '../layout-watcher'
import { resolve } from './catalog-types'
import type { SimpleSiteConfig, CatalogItem } from './catalog-types'

export const MARKERS = ['tile-link', 'tiles row']

export const GROUPLE_SITES: SimpleSiteConfig[] = [
  { name: 'Readmanga', base: 'https://readmanga.me', catalogPath: '/list?type=&sortType=rate', searchPath: '/search?q=', linkMarker: '/manga/' },
  { name: 'Mintmanga', base: 'https://mintmanga.com', catalogPath: '/list?sortType=rate', searchPath: '/search?q=', linkMarker: '/manga/' },
  { name: 'Mangapoisk', base: 'https://mangapoisk.me', catalogPath: '/manga', searchPath: '?search=', linkMarker: '/manga/' }
].map((s) => s as SimpleSiteConfig)

export function parseGroupleListing(html: string, base: string, _page = 0): CatalogItem[] {
  assertLayout(MARKERS, html, 'Grouple')
  const $ = cheerio.load(html)
  const results: CatalogItem[] = []
  const seen = new Set<string>()
  $('a.tile-link').each((_i, el) => {
    const href = $(el).attr('href') ?? ''
    if (!href.includes('/manga/')) return
    const full = resolve(base, href)
    if (!full || seen.has(full)) return
    seen.add(full)
    const title = $(el).find('.text-center').first().text().trim()
      ?? $(el).find('img').first().attr('title') ?? ''
    const rawCover = $(el).find('img').first().attr('src') ?? null
    results.push({ url: full, title, coverUrl: rawCover ? resolve(base, rawCover) : null, pages: null })
  })
  return results
}

export async function searchGrouple(
  cfg: SimpleSiteConfig,
  query: string,
  page = 0,
  fetchOverride?: (url: string) => Promise<string>
): Promise<CatalogItem[]> {
  const target = query.trim()
    ? `${cfg.base}${cfg.searchPath}${encodeURIComponent(query.trim())}`
    : `${cfg.base}${cfg.catalogPath}${page > 0 ? `?page=${page + 1}` : ''}`
  const html = fetchOverride ? await fetchOverride(target) : await fetchHtmlSmart(target)
  const results = parseGroupleListing(html, cfg.base, page)
  if (results.length === 0) throw new Error(`${cfg.name}: ничего не найдено (или вёрстка изменилась)`)
  return results
}
```

Имплементеру — реальные вёрстки grouple могут отличаться: маркеры/селекторы подбираются по реальной странице (`fetchHtmlSmart` в dev-режиме, см. ниже ручной smoke). Если питьев резольвер ссылок не `/manga/`, скорректировать селекторы по реалиям конкретного сайта после smoke.

- [ ] **Step 4: Подключение каталога + чтения**

В `src/main/index.ts` searchCatalog — новая ветка (уже после Ф-4 фасад):

```ts
import { searchGrouple, GROUPLE_SITES } from './services/sources/grouple'
import type { SimpleSiteConfig } from './services/sources/catalog-types'

const site = { readmanga: 0, mintmanga: 1, mangapoisk: 2 } as const
if (source in site) {
  const cfg = GROUPLE_SITES[site[source as keyof typeof site]] as SimpleSiteConfig
  return await searchGrouple(cfg, query, page, undefined)
}
```

В `resolve-gallery.ts`: расшифровка ветки simple-sites — хосты `readmanga./mintmanga./mangapoisk.` уже попадают в существующую ветку fetchSimpleGallery — проверить порядок условий в `resolveGallery`: добавить `'readmanga'`/`'mintmanga'`/`'mangapoisk'` в ту же условную цепочку, что mangashi/comx (простая строка OR). И `sourceLabel`: `if (l.includes('readmanga')) return 'Readmanga'` + аналоги.

В `Catalog.tsx` SOURCES добавить 3 пункта после mangalib:

```ts
  { key: 'readmanga', label: 'Readmanga' },
  { key: 'mintmanga', label: 'Mintmanga' },
  { key: 'mangapoisk', label: 'Mangapoisk' }
```

- [ ] **Step 5: Run tests + typecheck + commit**

Run: `npx vitest run tests/grouple.test.ts && npm run typecheck && npm test`
Expected: PASS

```bash
git add -A
git commit -m "feat(sources): grouple (readmanga/mintmanga/mangapoisk) catalog via anti-bot gate"
```

---

### Task 6: MangaMello источник

**Files:**
- Create: `src/main/services/sources/mangamello.ts`
- Test: `tests/mangamello.test.ts`
- Fixture: `tests/fixtures/mangamello-search.json`, `tests/fixtures/mangamello-chapter.json`
- Modify: `src/main/index.ts` (searchCatalog ветка + resolve-gallery ветка), `src/renderer/src/screens/Catalog.tsx` (SOURCES), `src/shared/ipc.ts` (source key)

**Interfaces:**
- Consumes: `httpFetch`, `httpGetJson` (http.ts), `CatalogItem`, `ChapterInfo` (remanga.ts).
- Produces:

```ts
export async function searchMangaMello(query: string, page = 0): Promise<CatalogItem[]>
export async function fetchMangaMelloChapter(chapterUrl: string): Promise<{ title: string; pageUrls: string[] }>
```

- [ ] **Step 1: Fixtures + failing tests**

`tests/fixtures/mangamello-search.json`:

```json
{ "results": [ { "idmanga": 77, "title": "Gintama", "cover": "https://api.mangamello.com/img/gintama.jpg", "chapter": 612 } ], "total": 1 }
```

`tests/fixtures/mangamello-chapter.json`:

```json
{ "idmanga": 77, "title": "Gintama", "chapter": 612, "pages": ["https://img.mangamello.com/77/612/1.jpg", "https://img.mangamello.com/77/612/2.jpg"] }
```

`tests/mangamello.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseMangaMelloSearch, parseMangaMelloChapter } from '../src/main/services/sources/mangamello'

const searchJson = readFileSync(join('tests', 'fixtures', 'mangamello-search.json'), 'utf-8')
const chapterJson = readFileSync(join('tests', 'fixtures', 'mangamello-chapter.json'), 'utf-8')

describe('mangamello parsers', () => {
  it('parses search results', () => {
    const r = parseMangaMelloSearch(searchJson, 'https://api.mangamello.com/v1/mangas/')
    expect(r).toHaveLength(1)
    expect(r[0].title).toBe('Gintama')
    expect(r[0].url).toContain('/manga/77/')
    expect(r[0].coverUrl).toContain('gintama.jpg')
    expect(r[0].pages).toBe(612)
  })
  it('parses chapter pages', () => {
    const r = parseMangaMelloChapter(chapterJson)
    expect(r.title).toContain('Gintama')
    expect(r.pageUrls).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mangamello.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
import { httpGetJson } from '../http'
import { assertLayout } from '../layout-watcher'
import type { CatalogItem } from './catalog-types'

const BASE = 'https://api.mangamello.com/v1/mangas/'

export function parseMangaMelloSearch(jsonText: string, base: string): CatalogItem[] {
  const j = JSON.parse(jsonText) as any
  const arr: any[] = j?.results ?? []
  assertLayout(['results', '"total"'], JSON.stringify({ results: [...arr] }), 'MangaMello')
  return arr.map((m) => ({
    url: `${base}${m?.idmanga ?? m?.id ?? ''}/`,
    title: m?.title ?? 'Без названия',
    coverUrl: typeof m?.cover === 'string' ? m.cover : null,
    pages: typeof m?.chapter === 'number' ? m.chapter : null
  }))
}

export function parseMangaMelloChapter(jsonText: string): { title: string; pageUrls: string[] } {
  const j = JSON.parse(jsonText) as any
  assertLayout(['pages', '"chapter"'], jsonText, 'MangaMello')
  const pages: string[] = (j?.pages ?? []).filter((u: any) => typeof u === 'string')
  if (pages.length === 0) throw new Error('MangaMello: глава без изображений')
  return { title: `MangaMello: ${j?.title ?? ''} глава ${j?.chapter ?? ''}`, pageUrls: pages }
}

export async function searchMangaMello(query: string, page = 0): Promise<CatalogItem[]> {
  const q = new URLSearchParams({ search: query.trim(), page: String(page + 1) })
  const raw = await httpGetJson(`${BASE}?${q.toString()}`, { Referer: BASE }) 
  return parseMangaMelloSearch(JSON.stringify(raw), BASE)
}

export async function fetchMangaMelloChapter(chapterUrl: string): Promise<{ title: string; pageUrls: string[] }> {
  // Chapter URL: https://api.mangamello.com/v1/mangas/<id>/<chapter>/
  const segs = chapterUrl.trim().replace(/\/+$/, '').split('/').filter(Boolean)
  const mangaId = segs[3] ?? ''
  const chapter = segs[4] ?? ''
  if (!mangaId || !chapter) throw new Error('MangaMello: не удалось разобрать URL главы')
  const raw = await httpGetJson(`${BASE}${mangaId}/${chapter}/`, { Referer: BASE })
  return parseMangaMelloChapter(JSON.stringify(raw))
}
```

- [ ] **Step 4: Подключение**

`src/shared/ipc.ts` `CatalogSourceKey`: добавить `'mangamello'`. В index.ts searchCatalog:

```ts
if (source === 'mangamello') return await searchMangaMello(query, page)
```

В resolve-gallery.ts: ветку для `mangamello.com`:

```ts
if (host.includes('mangamello.com')) {
  const r = await fetchMangaMelloChapter(trimmed)
  return { title: r.title, pageUrls: r.pageUrls, coverUrl: null, source: 'MangaMello', referer: 'https://mangamello.com/', mangaId: null, seriesId: trimmed }
}
```

Catalog.tsx SOURCES: `{ key: 'mangamello', label: 'MangaMello' }`.

- [ ] **Step 5: Run tests + typecheck + commit**

Run: `npx vitest run tests/mangamello.test.ts && npm run typecheck && npm test`
Expected: PASS

```bash
git add -A
git commit -m "feat(sources): MangaMello REST catalog + chapters"
```

---

### Task 7: Зеркала Lib семейства

**Files:**
- Modify: `src/shared/settings.ts` (поле + default + parse), `src/main/index.ts` (IPC `libMirrors:check` + задание актуального зеркала: перезапись URL в картинках)
- Modify: `src/main/services/covers.ts` (переписка до скачивания), `src/main/services/online-gallery.ts` (переписка при загрузке страницы)
- Modify: `src/main/services/sources/simple-sites.ts` (навигация каталога через выбранное зеркало: только для Lib-сайтов — опционально)
- Modify: `src/renderer/src/screens/Settings.tsx` (UI секция)
- Test: `tests/lib-mirror.test.ts`

**Interfaces:**
- Consumes: существующий SettingsService.
- Produces:

```ts
// src/main/services/sources/simple-sites.ts (или новый lib-mirrors.ts — следовать обоим паттернам: эти функции чистые, проще отдельно)
export const LIB_MIRRORS = ['img33.imgslib.link', 'img34.imgslib.link', 'img45.imgslib.link']
export function rewriteImglibHost(url: string, chosen: string | null): string
```

- [ ] **Step 1: Failing test на чистую функцию + settings parse**

`tests/lib-mirror.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rewriteImglibHost, LIB_MIRRORS } from '../src/main/services/lib-mirror'
import { defaultSettings, parseSettings } from '../src/shared/settings'

describe('rewriteImglibHost', () => {
  it('rewrites img host when chosen is set', () => {
    expect(rewriteImglibHost('https://img33.imgslib.link/a/b.jpg', 'img45.imgslib.link')).toBe('https://img45.imgslib.link/a/b.jpg')
  })
  it('keeps url when no mirror chosen', () => {
    expect(rewriteImglibHost('https://img33.imgslib.link/a/b.jpg', null)).toBe('https://img33.imgslib.link/a/b.jpg')
  })
  it('leaves non-imgslib urls alone', () => {
    expect(rewriteImglibHost('https://example.com/x.jpg', 'img45.imgslib.link')).toBe('https://example.com/x.jpg')
  })
  it('exposes known mirrors', () => {
    expect(LIB_MIRRORS.length).toBeGreaterThanOrEqual(3)
  })
})

describe('settings: lib_image_server', () => {
  it('defaults null and parses', () => {
    expect(defaultSettings().lib_image_server).toBeNull()
    expect(parseSettings({ lib_image_server: 'img45.imgslib.link' }).lib_image_server).toBe('img45.imgslib.link')
    expect(parseSettings({}).lib_image_server).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib-mirror.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

`src/main/services/lib-mirror.ts`:

```ts
export const LIB_MIRRORS = ['img33.imgslib.link', 'img34.imgslib.link', 'img45.imgslib.link']

export function rewriteImglibHost(url: string, chosen: string | null): string {
  if (!chosen) return url
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('.imgslib.link') && u.hostname !== chosen) {
      u.hostname = chosen
      return u.toString()
    }
    return url
  } catch {
    return url
  }
}
```

`src/shared/settings.ts` — добавить `lib_image_server: string | null` в Settings/default/parse (анологично `downloads_dir`).

`src/main/services/covers.ts` и `online-gallery.ts`: перед скачиванием переписать, если хост imgslib.link:

```ts
import { rewriteImglibHost } from './lib-mirror'
import { currentSettings } from '../main-settings-bridge' // НЕ допускаем цифровую зависимость: см. ниже
```

Зависимость цикл не допускается: сделать мост: в `src/main/index.ts` держать `getSettings()`, чтобы модули могли получить актуальное зеркало. Проще: экспортировать в `lib-mirror.ts` mutable:

```ts
import { rewriteImglibHost, LIB_MIRRORS, setLibMirror, libMirror } from './lib-mirror'
// rewriteImglibHost(url, libMirror())  // libMirror() возвращает текущее значение
```

Т.е. в lib-mirror.ts добавить mutable-ref:

```ts
let chosen: string | null = null
export function setLibMirror(v: string | null): void { chosen = v }
export function libMirror(): string | null { return chosen }
export function withMirror(url: string): string { return rewriteImglibHost(url, chosen) }
```

В `covers.ts`/`online-gallery.ts` обернуть URL: `withMirror(url)` прямо перед `fetchCoverBuffer`/`fetch`. index.ts: при старте и `setSettings` → `setLibMirror(s.lib_image_server)`.

IPC `libMirrors:check`:

```ts
ipcMain.handle('libMirrors:check', async () => {
  const results = await Promise.all(LIB_MIRRORS.map(async (host) => {
    const start = Date.now()
    try {
      await httpFetch({ url: `https://${host}/favicon.ico`, timeoutMs: 5000, frontOnEmpty: false })
      return { host, ok: true, ms: Date.now() - start }
    } catch (e: any) {
      return { host, ok: false, ms: -1, error: e?.message ?? String(e) }
    }
  }))
  return results
})
```

Settings.tsx — секция: select с known зеркалами + «Авто» (null) + кнопка Check показывающая таблицу ms и кнопку «Применить лучший» (выбрать минимальный ok). Приём: нужно `window.api.libMirrorsCheck()` (Api+preload+CH).

- [ ] **Step 4: Run tests + typecheck + commit**

Run: `npx vitest run tests/lib-mirror.test.ts && npm run typecheck && npm test`
Expected: PASS

```bash
git add -A
git commit -m "feat(lib-mirrors): configurable image server with ping check and URL rewrite"
```

---

### Task 8: Layout-watcher подключение во все HTML-парсеры

**Files:**
- Modify: `sources/simple-sites.ts`, `sources/mangashi.ts`, `sources/nhentai.ts`, `sources/eh.ts` (parseExHentaiListing), `sources/grouple.ts` (уже есть), `simple-gallery.ts` (общий фетч-парсер)
- Test: существующие тесты парсеров расширяются негативными сценариями

**Interfaces:**
- Consumes: `assertLayout` (Task 1).
- Produces: во всех HTML-парсерах — assertLayout(marker-список, html, source) В начале.

- [ ] **Step 1: Негативные тесты на каждый парсер**

В существующие тесты (`tests/catalog-search.test.ts`) добавить:

```ts
import { assertLayout } from '../src/main/services/layout-watcher'

describe('layout-watchdog integration', () => {
  it('throws layout-changed error when site markup is completely different', async () => {
    // simple-sites
    // httpFetch возвращает assertions как всё остальное → замокан заранее?
  })
})
```

Имплементеру: так как негативные сценарии зависят от внутренних вызовов, здесь делается через глобальный `vi.mock('../src/main/services/http')` в тесте, подменяющий `httpFetch` на страницу-мусор `<html>nothing here</html>`:

```ts
vi.mock('../src/main/services/http', () => ({
  httpFetch: vi.fn(async () => ({ status: 200, text: '<html>nothing here</html>' })),
  httpGetJson: vi.fn(),
  httpPostJson: vi.fn()
}))

// затем в тесте:
await expect(searchMangaShi('q', undefined, {}, 0)).rejects.toMatchObject({
  code: 'layout-changed',
  sourceName: 'Manga-shi'
})
```

(во всех остальных vendor-проверах — searchSimpleSite, searchNhentai, parseExHentaiListing — тот же паттерн.)

- [ ] **Step 2: Run to verify FAIL** (маркеров нет, но и layout-changed-ошибок нет).

- [ ] **Step 3: Подключение**

В начало каждого parse-функции (после `const $ = cheerio.load(...)`):

```ts
import { assertLayout } from '../layout-watcher'
// ...
assertLayout(['.media-shell'], html, 'Manga-shi')
assertLayout(['a.cover'], html, 'NHentai')
assertLayout(['.itg', '.glink'], html, 'E-Hentai list')
assertLayout(['linkMarker'], html, cfg.name) // simple-sites: маркер cfg.linkMarker
```

Подобрать маркеры так, чтобы они существуют в текущих фиксстурах (проходят существующие тесты).

Also: `listComplex`? нет. Не забыть run существующих тестов, чтобы маркеры правильные (проверка против fixtures), пробегом Type-check.

- [ ] **Step 4: Run tests + typecheck + commit**

Run: `npm run typecheck && npm test`
Expected: PASS

```bash
git add -A
git commit -m "feat(layout-watcher): wire assertLayout into all HTML parsers"
```

---

### Task 9: Ручной smoke + финальная проверка

**Files:** —

- [ ] **Step 1: Полная проверка**

Run: `npm run typecheck && npm test`
Expected: PASS (полним БЕЗ запрещённых пропусков).

- [ ] **Step 2: Dev smoke (вручную, реализатор)**

- `npm run dev` → каталог: новый источник Readmanga выдаёт карточки (при CF — fallback браузер сработал).
- Com-X/Manga-shi по-прежнему работают через браузер fallback при блокировке.
- MangaMello: карточки и открытие главы.
- Settings: «Проверить зеркала» показывает пинг; выбранное зеркало меняет хост картинок Lib-страниц.

- [ ] **Step 3: Final commit (если остались изменения)**

```bash
git status --short
git add -A
git commit -m "chore: manual smoke fixes after MangaNet-derived features"
```
