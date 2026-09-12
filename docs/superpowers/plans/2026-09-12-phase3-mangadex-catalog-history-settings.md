# Manga Reader Electron — Phase 3: MangaDex + Cover + History/Settings Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить онлайн-чтение MangaDex (поиск, главы, страницы через at-home API), каталог-сетку карточек, обложки через протокол, полноценные экраны «История» и «Настройки».

**Architecture:** Сеть в main (`fetch`/undici). Парсинг JSON MangaDex вынесен в чистые функции (тестируемые на фикстурах). Онлайн-страницы грузятся в main-кэш пулом с лимитом параллельности и префетчем; протокол `manga://page/<gid>/<index>` отдаёт либо локальный файл, либо байты из кэша (дожидаясь загрузки). Обложки — `manga://cover/<url>` с per-site Referer.

**Tech Stack:** Electron, React, TS, Vitest, undici/fetch (built-in).

## Global Constraints

- Формат settings.json идентичен Rust-версии.
- Русские UI-строки из исходника сохраняются («Ничего не найдено.», «У этой манги пока нет доступных глав.» и т.д.).
- Сеть в тестах — только локальный мок-сервер / чистые функции на фикстурах. Реальные сайты не трогать.
- MangaDex API: `/manga`, `/manga/{id}/feed`, `/manga/{id}/aggregate`, `/at-home/server/{chapterId}`.
- Коммит после каждой задачи.

---

### Task 1: MangaDex API — чистые парсеры + сетевой сервис

**Files:**
- Create: `src/main/services/http.ts`
- Create: `src/main/services/mangadex.ts`
- Create: `tests/mangadex.test.ts`
- Create: `tests/fixtures/mangadex-search.json`, `tests/fixtures/mangadex-feed.json`, `tests/fixtures/mangadex-aggregate.json`

**Interfaces:**
- Produces:
  - `httpGetJson(url, headers?)`: Promise<unknown> — fetch с User-Agent `manga_reader/0.1`, gzip автоматически, timeout 20s.
  - `MangaCard { manga_id, title, cover_url, kind, score, tags }`
  - `parseMangaSearch(json): MangaCard[]`
  - `parseChapterFeed(json): ChapterInfo[]` где `ChapterInfo { chapter_id, chapter_num, title, lang }`
  - `parseAggregate(json): number`
  - `searchMangaDex(query, sort, page, tags?, langs?): Promise<MangaCard[]>`
  - `fetchChapterList(manga_id): Promise<ChapterInfo[]>` (ru → en)
  - `fetchChapterCount(manga_id): Promise<number>`
  - `resolveAtHome(chapter_id): Promise<{ baseUrl, hash, files }>`

- [ ] **Step 1: Фикстуры** (реальные примеры ответов API, урезанные)

`tests/fixtures/mangadex-search.json`:
```json
{
  "result": "ok",
  "data": [
    {
      "id": "a1b2c3",
      "type": "manga",
      "attributes": {
        "title": { "en": "My Hero", "ru": "Герой" },
        "altTitles": [ { "ru": "АльтГерой" } ],
        "originalLanguage": "ja",
        "rating": { "bayesian": 9.12 },
        "tags": [ { "attributes": { "name": { "en": "Action", "ru": "Экшен" } } } ]
      },
      "relationships": [
        { "type": "cover_art", "attributes": { "fileName": "abc.jpg" } }
      ]
    },
    {
      "id": "x9y8",
      "type": "manga",
      "attributes": {
        "title": { "ko": "Ханча" },
        "altTitles": [],
        "originalLanguage": "ko",
        "rating": { "bayesian": 7.5 },
        "tags": []
      },
      "relationships": []
    }
  ]
}
```

`tests/fixtures/mangadex-feed.json`:
```json
{
  "result": "ok",
  "data": [
    { "id": "ch1", "type": "chapter", "attributes": { "chapter": "1", "title": "Начало", "translatedLanguage": "ru" } },
    { "id": "ch2", "type": "chapter", "attributes": { "chapter": "2.5", "title": null, "translatedLanguage": "ru" } },
    { "id": "ch3", "type": "chapter", "attributes": { "chapter": null, "title": "Спешл", "translatedLanguage": "ru" } }
  ]
}
```

`tests/fixtures/mangadex-aggregate.json`:
```json
{
  "result": "ok",
  "volumes": {
    "1": { "chapters": { "1": {}, "2": {}, "3": {} } },
    "2": { "chapters": { "4": {}, "5": {} } }
  }
}
```

- [ ] **Step 2: Падающие тесты**

`tests/mangadex.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseMangaSearch, parseChapterFeed, parseAggregate } from '../src/main/services/mangadex'

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))

describe('parseMangaSearch', () => {
  it('parses titles, kind, score, tags, cover', () => {
    const cards = parseMangaSearch(fixture('mangadex-search.json'))
    expect(cards).toHaveLength(2)
    const [c1, c2] = cards
    expect(c1.manga_id).toBe('a1b2c3')
    expect(c1.title).toBe('Герой')
    expect(c1.cover_url).toBe('https://uploads.mangadex.org/covers/a1b2c3/abc.jpg.256.jpg')
    expect(c1.kind).toBe('Манга')
    expect(c1.score).toBeCloseTo(9.12)
    expect(c1.tags).toEqual(['Экшен'])
    expect(c2.kind).toBe('Манхва')
    expect(c2.cover_url).toBeNull()
  })
})

describe('parseChapterFeed', () => {
  it('parses chapter numbers and titles, defaulting missing num to —', () => {
    const chs = parseChapterFeed(fixture('mangadex-feed.json'))
    expect(chs.map((c) => c.chapter_num)).toEqual(['1', '2.5', '—'])
    expect(chs[0].title).toBe('Начало')
    expect(chs[1].title).toBeNull()
    expect(chs.map((c) => c.chapter_id)).toEqual(['ch1', 'ch2', 'ch3'])
  })
})

describe('parseAggregate', () => {
  it('counts chapters across volumes', () => {
    expect(parseAggregate(fixture('mangadex-aggregate.json'))).toBe(5)
  })
})
```

- [ ] **Step 3: Запустить — падает**

Run: `npm test -- tests/mangadex.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 4: Реализовать**

`src/main/services/http.ts`:
```ts
export async function httpGetJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'manga_reader/0.1', Accept: 'application/json', ...headers },
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function httpGetText(url: string, headers: Record<string, string> = {}, timeoutMs = 20_000): Promise<{ status: number; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'manga_reader/0.1', ...headers },
      signal: controller.signal
    })
    return { status: res.status, text: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}
```

`src/main/services/mangadex.ts`:
```ts
import { httpGetJson } from './http'

export interface MangaCard {
  manga_id: string
  title: string
  cover_url: string | null
  kind: string
  score: number | null
  tags: string[]
}

export interface ChapterInfo {
  chapter_id: string
  chapter_num: string
  title: string | null
  lang: string
}

export type MangaSort = 'relevance' | 'rating' | 'latestUploadedChapter' | 'followedCount'

const ORDER_KEY: Record<MangaSort, string> = {
  relevance: 'relevance', rating: 'rating',
  latestUploadedChapter: 'latestUploadedChapter', followedCount: 'followedCount'
}

export function parseMangaSearch(json: any): MangaCard[] {
  const data: any[] = json?.data ?? []
  const cards: MangaCard[] = []
  for (const manga of data) {
    const id = manga?.id
    if (typeof id !== 'string') continue
    const attrs = manga.attributes ?? {}
    const titles = attrs.title ?? {}
    const altTitles: any[] = attrs.altTitles ?? []
    const findAlt = (lang: string): string | null =>
      altTitles.map((t) => t?.[lang]).find((v) => typeof v === 'string') ?? null
    const title =
      titles.ru ?? findAlt('ru') ?? titles.en ?? findAlt('en') ?? titles['ja-ro'] ?? findAlt('ja-ro')
      ?? Object.values(titles).find((v) => typeof v === 'string') ?? 'Без названия'
    const origLang = attrs.originalLanguage ?? ''
    const kind = origLang === 'ko' ? 'Манхва' : (origLang === 'zh' || origLang === 'zh-hk') ? 'Маньхуа' : 'Манга'
    const score = typeof attrs.rating?.bayesian === 'number' ? attrs.rating.bayesian : null
    const tags: string[] = (attrs.tags ?? []).map((t: any) =>
      t?.attributes?.name?.ru ?? t?.attributes?.name?.en).filter((s: unknown): s is string => typeof s === 'string')
    const coverFile = (manga.relationships ?? []).find((r: any) => r?.type === 'cover_art')?.attributes?.fileName
    const cover_url = typeof coverFile === 'string' ? `https://uploads.mangadex.org/covers/${id}/${coverFile}.256.jpg` : null
    cards.push({ manga_id: id, title, cover_url, kind, score, tags })
  }
  return cards
}

export function parseChapterFeed(json: any): ChapterInfo[] {
  const data: any[] = json?.data ?? []
  const out: ChapterInfo[] = []
  for (const ch of data) {
    const id = ch?.id
    if (typeof id !== 'string') continue
    const attrs = ch.attributes ?? {}
    const chapter_num = typeof attrs.chapter === 'string' ? attrs.chapter : '—'
    const title = typeof attrs.title === 'string' && attrs.title.length > 0 ? attrs.title : null
    out.push({ chapter_id: id, chapter_num, title, lang: attrs.translatedLanguage ?? '' })
  }
  return out
}

export function parseAggregate(json: any): number {
  const volumes: Record<string, any> = json?.volumes ?? {}
  let total = 0
  for (const vol of Object.values(volumes)) {
    total += Object.keys(vol?.chapters ?? {}).length
  }
  return total
}

async function fetchFeed(manga_id: string, lang: string): Promise<ChapterInfo[]> {
  const url = `https://api.mangadex.org/manga/${manga_id}/feed`
  const params = new URLSearchParams({ 'order[chapter]': 'asc', limit: '500', 'translatedLanguage[]': lang })
  const all: ChapterInfo[] = []
  let offset = 0
  for (;;) {
    params.set('offset', String(offset))
    const json = await httpGetJson(`${url}?${params.toString()}`)
    const batch = parseChapterFeed(json)
    all.push(...batch)
    if (batch.length < 500) break
    offset += 500
  }
  return all
}

export async function searchMangaDex(
  query: string, sort: MangaSort, page: number,
  tags: string[] = [], langs: string[] = []
): Promise<MangaCard[]> {
  const params = new URLSearchParams({ limit: '30', offset: String(page * 30), 'includes[]': 'cover_art' })
  params.set(`order[${ORDER_KEY[sort]}]`, 'desc')
  for (const r of ['safe', 'suggestive', 'erotica']) params.append('contentRating[]', r)
  if (query) params.set('title', query)
  for (const t of tags) params.append('includedTags[]', t)
  for (const l of langs) params.append('availableTranslatedLanguage[]', l)
  const json = await httpGetJson(`https://api.mangadex.org/manga?${params.toString()}`)
  const cards = parseMangaSearch(json)
  if (cards.length === 0) throw new Error('Ничего не найдено.')
  return cards
}

export async function fetchChapterList(manga_id: string): Promise<ChapterInfo[]> {
  const ru = await fetchFeed(manga_id, 'ru')
  if (ru.length > 0) return ru
  const en = await fetchFeed(manga_id, 'en')
  if (en.length > 0) return en
  throw new Error('У этой манги пока нет доступных глав.')
}

export async function fetchChapterCount(manga_id: string): Promise<number> {
  const params = new URLSearchParams({ 'translatedLanguage[]': 'ru' })
  let json = await httpGetJson(`https://api.mangadex.org/manga/${manga_id}/aggregate?${params.toString()}`)
  let count = parseAggregate(json)
  if (count === 0) {
    json = await httpGetJson(`https://api.mangadex.org/manga/${manga_id}/aggregate`)
    count = parseAggregate(json)
  }
  return count
}

export interface AtHomeChapter {
  baseUrl: string
  hash: string
  files: string[]
}

export async function resolveAtHome(chapter_id: string): Promise<AtHomeChapter> {
  const json: any = await httpGetJson(`https://api.mangadex.org/at-home/server/${chapter_id}`)
  const baseUrl = json?.baseUrl
  const hash = json?.chapter?.hash
  const files: unknown = json?.chapter?.data
  if (typeof baseUrl !== 'string') throw new Error("API response missing 'baseUrl'")
  if (typeof hash !== 'string') throw new Error("API response missing 'chapter.hash'")
  if (!Array.isArray(files) || files.length === 0) throw new Error('Chapter has no pages')
  return { baseUrl, hash, files: files.filter((f): f is string => typeof f === 'string') }
}
```

- [ ] **Step 5: Тесты проходят**

Run: `npm test -- tests/mangadex.test.ts`
Expected: PASS (3 tests). `npm run typecheck` — чисто.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: mangadex api with parseable pure functions"
```

---

### Task 2: Онлайн-галерея с кэшем и протоколом

**Files:**
- Create: `src/main/services/online-gallery.ts`
- Modify: `src/main/services/gallery.ts` (общая структура)
- Modify: `src/main/index.ts`
- Create: `tests/online-gallery.test.ts`

**Interfaces:**
- Consumes: `resolveAtHome`.
- Produces:
  - `createOnlineGallery(title, pageUrls, referer?): string` — возвращает gid
  - `requestPage(gid, index, headers?): Promise<Buffer | null>` — качает с лимитом параллельности и префетчем по позиции
  - `setReadingPosition(gid, index): void`
  - `getLocalGallery(gid): Gallery | null`
  - Лимиты: `MAX_CONCURRENT = 6`, `LOAD_AHEAD = 32`, `KEEP_BEHIND = 4` (константы экспортируются для тестов).

- [ ] **Step 1: Падающий тест**

`tests/online-gallery.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createHttpServer } from 'http'
import { createOnlineGallery, setReadingPosition, requestPage, MAX_CONCURRENT } from '../src/main/services/online-gallery'

describe('online gallery', () => {
  it('fetches and caches pages, honors concurrency', async () => {
    let active = 0
    let peak = 0
    const server = createHttpServer((req, res) => {
      active++
      peak = Math.max(peak, active)
      setTimeout(() => { active--; res.end(`img-${req.url}`) }, 5)
    })
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as any).port
    const gid = createOnlineGallery('Test', [`http://127.0.0.1:${port}/1`, `http://127.0.0.1:${port}/2`, `http://127.0.0.1:${port}/3`])
    const urls = [`http://127.0.0.1:${port}/1`, `http://127.0.0.1:${port}/2`, `http://127.0.0.1:${port}/3`]
    const results = await Promise.all(urls.map((_, i) => requestPage(gid, i, {})))
    expect(results.map((b) => b?.toString())).toEqual(['img-/1', 'img-/2', 'img-/3'])
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT)
    server.close()
  })

  it('throws a clear error on non-200', async () => {
    const server = createHttpServer((_req, res) => { res.statusCode = 404; res.end('nope') })
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as any).port
    const gid = createOnlineGallery('Bad', [`http://127.0.0.1:${port}/x`])
    await expect(requestPage(gid, 0, {})).rejects.toThrow(/HTTP 404/)
    server.close()
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `npm test -- tests/online-gallery.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

`src/main/services/online-gallery.ts`:
```ts
import { randomUUID } from 'crypto'

export const MAX_CONCURRENT = 6
export const LOAD_AHEAD = 32
export const KEEP_BEHIND = 4

interface Entry {
  index: number
  url: string
  buffer: Buffer | null
  state: 'idle' | 'loading' | 'done' | 'failed'
  error: string | null
  promise: Promise<void> | null
}

interface OnlineGallery {
  title: string
  entries: Entry[]
  position: number
}

const galleries = new Map<string, OnlineGallery>()
let inFlight = 0
const queue: (() => void)[] = []

function pump(): void {
  while (inFlight < MAX_CONCURRENT && queue.length > 0) {
    const fn = queue.shift()!
    inFlight++
    fn()
  }
}

export function createOnlineGallery(title: string, urls: string[]): string {
  const gid = randomUUID()
  galleries.set(gid, {
    title,
    entries: urls.map((url, index) => ({ index, url, buffer: null, state: 'idle', error: null, promise: null })),
    position: 0
  })
  return gid
}

export function setReadingPosition(gid: string, index: number): void {
  const g = galleries.get(gid)
  if (!g) return
  g.position = index
  // evict far-behind
  for (const e of g.entries) {
    if (e.state === 'done' && e.index < index - KEEP_BEHIND) {
      e.buffer = null
      e.state = 'idle'
    }
  }
}

async function loadOne(g: OnlineGallery, e: Entry, headers: Record<string, string>): Promise<void> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await fetch(e.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...headers },
        signal: controller.signal
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${e.url}`)
      e.buffer = Buffer.from(await res.arrayBuffer())
      e.state = 'done'
    } finally {
      clearTimeout(timer)
    }
  } catch (err: any) {
    e.error = err?.message ?? String(err)
    e.state = 'failed'
  } finally {
    inFlight--
    pump()
  }
}

export function requestPage(gid: string, index: number, headers: Record<string, string>): Promise<Buffer | null> {
  const g = galleries.get(gid)
  if (!g) throw new Error('Gallery not found')
  const e = g.entries[index]
  if (!e) throw new Error(`Page ${index} out of range`)
  if (e.state === 'done') return Promise.resolve(e.buffer)
  if (e.state === 'failed') return Promise.reject(new Error(e.error ?? 'failed'))
  if (e.promise) return e.promise.then(() => (e.state === 'done' ? e.buffer : Promise.reject(new Error(e.error ?? 'failed'))))

  // warm-ahead
  const start = Math.max(0, g.position - KEEP_BEHIND)
  const end = Math.min(g.entries.length, g.position + LOAD_AHEAD + 1)
  const toWarm = g.entries.slice(start, end).filter((x) => x.state === 'idle' && x.promise === null)

  const promise = new Promise<void>((resolvePromise) => {
    queue.push(() => {
      void loadOne(g, e, headers).then(resolvePromise)
    })
  })
  e.promise = promise
  for (const w of toWarm) {
    if (w === e || w.promise) continue
    w.promise = new Promise<void>((rp) => {
      queue.push(() => { void loadOne(g, w, headers).then(rp) })
    })
  }
  pump()
  return promise.then(() => (e.state === 'done' ? e.buffer : Promise.reject(new Error(e.error ?? 'failed'))))
}

export function getGalleryPages(gid: string): { title: string; pageCount: number } | null {
  const g = galleries.get(gid)
  return g ? { title: g.title, pageCount: g.entries.length } : null
}
```

- [ ] **Step 4: Тесты проходят**

Run: `npm test -- tests/online-gallery.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: online gallery cache with concurrency pool"
```

---

### Task 3: IPC openUrl + протокол для онлайн-страниц/обложек

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/ipc.ts`

**Interfaces:**
- Produces:
  - `window.api.openUrl(url, chapterId?)`: детектит MangaDex-цель (UUID или `mangadex.org/chapter/<id>`), резолвит at-home, создаёт online-галерею, возвращает `OpenResult { id, title, pageCount, source }`
  - `window.api.fetchChapterList(mangaId)`
  - Протокол `manga://page/<gid>/<index>` — онлайн: `requestPage`, локальные файлы по-прежнему работают.
  - Протокол `manga://cover/<base64url>` — качает обложку с Referer `https://mangadex.org/`, кэш по URL.

- [ ] **Step 1: IPC-каналы и preload**

Добавить в `src/shared/ipc.ts`:
```ts
export interface OpenResult {
  id: string
  title: string
  pageCount: number
  source: string
}
```
и в `Api`:
```ts
openUrl(url: string): Promise<OpenResult | null>
fetchChapterList(mangaId: string): Promise<{ chapters: { chapter_id: string; chapter_num: string; title: string | null }[] }>
```
и каналы `url:open`, `manga:chapters`.

В `preload` добавить методы.

- [ ] **Step 2: main — обработчики**

В `src/main/index.ts`:
- Импорт `resolveAtHome, fetchChapterList`, `createOnlineGallery, requestPage, setReadingPosition`.
- Новые каналы + детект цели (порт `is_mangadex_target`): если UUID (36 симв., формат) или `mangadex.org` → резолв.
- Хранить `onlineHeaders: Map<gid, Record<string, string>>` (Referer `https://mangadex.org/`).
- Протокол `manga://page`: hostname = gid. Если галерея локальная (в `galleries`) → net.fetch(file). Если онлайн → `requestPage`, отдать Response(buffer).
- Протокол `manga://cover/<base64url>`: кэш `Map<string, Buffer>`, Referer mangadex.org, 20s timeout, fallback — 404.
- Канал `setReadingPosition` (`reader:position`).

- [ ] **Step 3: Проверка**

Run: `npm run typecheck` — чисто. `npm run build` — собирается.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: open mangadex chapter via IPC and online page protocol"
```

---

### Task 4: Каталог MangaDex — сетка карточек

**Files:**
- Create: `src/renderer/src/screens/Catalog.tsx` (полный)
- Create: `src/renderer/src/components/MangaCardGrid.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/shared/ipc.ts` (канал поиска)

**Interfaces:**
- Produces: поиск по названию, сортировка (релевантность/рейтинг/последние/подписки), пагинация (кнопки Пред/След), карточки с обложкой `manga://cover/<...>`, kind, score, главы; клик по карточке → список глав → открытие главы через `openUrl`.

- [ ] **Step 1: IPC-канал поиска**

В `Api`/`CH` добавить `searchCatalog(query, sort, page)` → `MangaCard[]` (тип из `@shared/mangadex`), канал `catalog:search`. В main — обработчик, вызывающий `searchMangaDex`.

- [ ] **Step 2: Компонент сетки**

`MangaCardGrid.tsx`: grid карточек; обложка (или placeholder), title (truncate), kind + score, кнопка «Главы». Кешировать обложки не нужно — протокол уже кэширует.

- [ ] **Step 3: Экран Catalog**

Поля: поиск, селект сортировки, кнопка «Найти», сетка, «Пред./След.» пагинация. Выбор карточки открывает список глав (fetchChapterList) в модале; клик по главе → `openUrl(chapter_id)` → перейти на Reader с открытой галереей.

Для передачи открытой галереи в Reader: добавить в store `opened: OpenResult | null` и `openResult(r)`, Reader использует его вместо локальной папки (унифицировать с `useGallery` — расширить state до `{ kind: 'local'|'online', id, title, pageCount, pages? }`).

- [ ] **Step 4: Стили и проверка**

Добавить `.catalog-grid`, `.manga-card`, `.manga-card img` и т.д. Проверить `npm run typecheck`, запустить dev (поиск «naruto» — сетка рендерится; без сети — сообщение об ошибке, не краш).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: mangadex catalog with card grid and chapter picker"
```

---

### Task 5: Экран «История»

**Files:**
- Modify: `src/renderer/src/screens/History.tsx` (полный)
- Create: `src/renderer/src/components/HistoryCardGrid.tsx`
- Modify: `src/shared/ipc.ts` (переоткрытие из истории)

**Interfaces:**
- Consumes: `getHistory`, `recordProgress`, `openUrl`, `openFolder`.
- Produces: вкладки Main/R34, карточки с обложкой (`cover_url` → `manga://cover/`), title, source · гл. N, прогресс-бар (глава + серия), кнопка «▶ Продолжить/Открыть», кнопка «Очистить».

- [ ] **Step 1: IPC — продолжить чтение**

`Api.clearHistory()`, `Api.continueEntry(url)` — определяет тип по `file://` (openFolder) или UUID/URL (openUrl + restore page). Канал `history:clear`, `history:continue`. В main: continue возвращает `OpenResult & { startPage }`, reader открывает на `startPage`.

- [ ] **Step 2: Карточки истории**

`HistoryCardGrid.tsx`: сетка (min 200px, авто-колонки), обложка через `manga://cover/`, title (46 симв), мета source · гл., кнопка continue, два прогресс-бара, hover-обводка.

- [ ] **Step 3: Экран**

Вкладки 📖 Main / 🔞 R34 (по `show_r34_history`), «🗑 Очистить», пустое состояние «Нет истории просмотров». Выбор карточки → continueEntry → Reader на startPage.

- [ ] **Step 4: Проверка и коммит**

`npm run typecheck` + dev. Записать прогресс при открытии (openUrl уже пишет в history через существующий flow; reader шлёт recordProgress при смене страницы).
```bash
git add -A
git commit -m "feat: history screen with cards, covers, continue"
```

---

### Task 6: Экран «Настройки»

**Files:**
- Modify: `src/renderer/src/screens/Settings.tsx` (полный)
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `settings`, `setSettings`.
- Produces: секции Reading (mode/direction/pages per screen/page margin/width scale), Display (thumbnails, thumb size), Приватность (показ R34). Значения пишутся в settings через store (автосохранение).

- [ ] **Step 1: Реализовать экран**

Секции в ScrollArea, стили фреймов как в Rust-версии (fill `#0a0a16`, border `#2d2d4e`, заголовок оранжевый). Сетевой раздел и куки — позже (фаза Tor).

- [ ] **Step 2: Проверка и коммит**

`npm run typecheck` + dev: переключение настроек сохраняется в settings.json.
```bash
git add -A
git commit -m "feat: settings screen with reading and display sections"
```

---

## Self-Review

- **Spec coverage фазы 3:** MangaDex API ✓, онлайн-галерея ✓, обложки ✓, каталог-сетка ✓, экран истории ✓, экран настроек ✓. Tor/куки/веб-логин/остальные 10 источников — фаза 5+.
- **Placeholders:** код приведён для ключевых шагов; сетевые обработчики IPC в Task 3–5 опираются на интерфейсы Task 1–2.
- **Type consistency:** `OpenResult` единый (id/title/pageCount/source); `ChapterInfo` в mangadex.ts и IPC-возврате согласован; `manga://page/<gid>/<index>` и `manga://cover/<url>` согласованы между main и renderer.