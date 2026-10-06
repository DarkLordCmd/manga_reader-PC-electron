# Быстрый поиск + Популярное + Рейтинг (JHenTai) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить пресеты быстрого поиска, экран «Популярное» (ранклист E-Hentai/ExHentai `/popular`) и фильтр минимального рейтинга (`f_srdd`) в EH-поиске.

**Architecture:** Пресеты — в `settings.json` (чистые функции). EH `/popular` тянется в main и парсится существующим `parseExHentaiListing` (общий helper с `searchExHentai`). Минимальный рейтинг — параметр `f_srdd` в EH-поиске. Renderer — экран Popular + UI пресетов, через типизированный IPC.

**Tech Stack:** TypeScript, Electron 33, React 18, cheerio, vitest. Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-06-jhentai-search-popular-rating-design.md`

## Global Constraints

- Сеть/файлы — только в main; renderer — через `src/shared/ipc.ts`.
- `better-sqlite3` вне renderer/vitest.
- Русские пользовательские сообщения.
- После каждого таска: `npm run typecheck && npm test` проходят.
- Рабочее дерево содержит WIP: частичный стейджинг только своих hunks.

---

### Task 1: `quick-search.ts` + настройка `quick_searches`

**Files:**
- Create: `src/shared/quick-search.ts`
- Modify: `src/shared/settings.ts`
- Test: `tests/quick-search.test.ts`

**Interfaces:**
- Produces: `QuickSearch = { id; name; source; query }`; `normalizeQuickSearches(raw): QuickSearch[]`; `addQuickSearch(list, entry)`; `removeQuickSearch(list, id)`; `moveQuickSearch(list, id, dir)`; `Settings.quick_searches: QuickSearch[]`.

- [ ] **Step 1: Write the failing test**

`tests/quick-search.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeQuickSearches, addQuickSearch, removeQuickSearch, moveQuickSearch, type QuickSearch } from '../src/shared/quick-search'
import { defaultSettings, parseSettings } from '../src/shared/settings'

const q = (id: string, name: string): QuickSearch => ({ id, name, source: 'exhentai', query: name })

describe('quick-search', () => {
  it('normalizes only valid entries', () => {
    expect(normalizeQuickSearches([{ id: '1', name: 'a', source: 'exhentai', query: 'x' }, { name: 'bad' }, null])).toEqual([
      { id: '1', name: 'a', source: 'exhentai', query: 'x' }
    ])
  })
  it('add/remove', () => {
    let list: QuickSearch[] = []
    list = addQuickSearch(list, q('1', 'a'))
    list = addQuickSearch(list, q('2', 'b'))
    expect(list.map((x) => x.id)).toEqual(['1', '2'])
    expect(removeQuickSearch(list, '1').map((x) => x.id)).toEqual(['2'])
  })
  it('move up/down clamps', () => {
    const list = [q('1', 'a'), q('2', 'b'), q('3', 'c')]
    expect(moveQuickSearch(list, '1', 'up').map((x) => x.id)).toEqual(['1', '2', '3'])
    expect(moveQuickSearch(list, '1', 'down').map((x) => x.id)).toEqual(['2', '1', '3'])
    expect(moveQuickSearch(list, '3', 'down').map((x) => x.id)).toEqual(['1', '2', '3'])
  })
})

describe('settings.quick_searches', () => {
  it('defaults empty and parses valid entries', () => {
    expect(defaultSettings().quick_searches).toEqual([])
    expect(parseSettings({ quick_searches: [{ id: '1', name: 'a', source: 'exhentai', query: 'x' }, { bad: 1 }] }).quick_searches)
      .toEqual([{ id: '1', name: 'a', source: 'exhentai', query: 'x' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quick-search.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/shared/quick-search.ts`:

```ts
export interface QuickSearch {
  id: string
  name: string
  source: string
  query: string
}

export function normalizeQuickSearches(raw: unknown): QuickSearch[] {
  if (!Array.isArray(raw)) return []
  const out: QuickSearch[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id || typeof o.name !== 'string') continue
    out.push({
      id: o.id, name: o.name,
      source: typeof o.source === 'string' && o.source ? o.source : 'exhentai',
      query: typeof o.query === 'string' ? o.query : ''
    })
  }
  return out
}

export function addQuickSearch(list: QuickSearch[], entry: QuickSearch): QuickSearch[] {
  return [...list, entry]
}

export function removeQuickSearch(list: QuickSearch[], id: string): QuickSearch[] {
  return list.filter((q) => q.id !== id)
}

export function moveQuickSearch(list: QuickSearch[], id: string, dir: 'up' | 'down'): QuickSearch[] {
  const i = list.findIndex((q) => q.id === id)
  if (i < 0) return list
  const j = dir === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}
```

`src/shared/settings.ts`:
- import `import { normalizeQuickSearches, type QuickSearch } from './quick-search'`.
- `Settings` + `quick_searches: QuickSearch[]` (после `last_catalog_source`).
- `defaultSettings()` + `quick_searches: []`.
- `parseSettings()` + `quick_searches: normalizeQuickSearches(o.quick_searches)`.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/quick-search.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/quick-search.ts src/shared/settings.ts tests/quick-search.test.ts
git commit -m "feat(search): quick-search presets in settings (pure helpers)"
```

---

### Task 2: EH — минимальный рейтинг + `fetchEhPopular`

**Files:**
- Modify: `src/main/services/sources/eh.ts`
- Modify: `src/shared/ipc.ts` (`CatalogFilters.ehMinRating`)
- Modify: `src/main/index.ts` (передать `minRating` в `searchExHentai`)
- Test: `tests/eh-search-params.test.ts`

**Interfaces:**
- Produces:
  - `buildEhSearchParams(opts: { query: string; excludedCats?: number; minRating?: number; inlineSet?: boolean; cursor?: { dir: 'next'|'prev'; gid: string } }): string[]`
  - `searchExHentai(query, opts)` — в opts добавляется `minRating?: number`.
  - `fetchEhPopular(source: 'ehentai'|'exhentai'|'exhentai_onion', opts: { cookieHeader: string; torSocksAddr: string; exProxyAddr?: string; torProxied: boolean }): Promise<ExSearchResult[]>`
  - `CatalogFilters.ehMinRating?: number`.

- [ ] **Step 1: Write the failing test**

`tests/eh-search-params.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildEhSearchParams } from '../src/main/services/sources/eh'

describe('buildEhSearchParams', () => {
  it('includes f_search and f_cats', () => {
    expect(buildEhSearchParams({ query: 'a b', excludedCats: 3 })).toEqual(['f_search=a%20b', 'f_cats=3'])
  })
  it('includes f_srdd when minRating > 0', () => {
    expect(buildEhSearchParams({ query: '', minRating: 4 })).toContain('f_srdd=4')
    expect(buildEhSearchParams({ query: '', minRating: 0 })).not.toContain('f_srdd=0')
  })
  it('includes inline_set and cursor', () => {
    const p = buildEhSearchParams({ query: 'x', inlineSet: true, cursor: { dir: 'next', gid: '9' } })
    expect(p).toContain('inline_set=dm_t')
    expect(p).toContain('next=9')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eh-search-params.test.ts`
Expected: FAIL — `buildEhSearchParams` not exported.

- [ ] **Step 3: Implement `buildEhSearchParams` + use it in `searchExHentai`**

В `src/main/services/sources/eh.ts`:

```ts
export function buildEhSearchParams(opts: {
  query: string
  excludedCats?: number
  minRating?: number
  inlineSet?: boolean
  cursor?: { dir: 'next' | 'prev'; gid: string }
}): string[] {
  const params: string[] = []
  if (opts.query.trim()) params.push(`f_search=${encodeURIComponent(opts.query)}`)
  const cats = opts.excludedCats ?? 0
  if (cats > 0) params.push(`f_cats=${cats}`)
  if (opts.minRating && opts.minRating > 0) params.push(`f_srdd=${opts.minRating}`)
  if (opts.inlineSet) params.push('inline_set=dm_t')
  if (opts.cursor) params.push(`${opts.cursor.dir}=${opts.cursor.gid}`)
  return params
}
```
Заменить блок сборки `params` в `searchExHentai` на:

```ts
  const params = buildEhSearchParams({
    query, excludedCats: opts.excludedCats ?? 0, minRating: opts.minRating,
    inlineSet: !!opts.domainOverride, cursor: opts.cursor
  })
```
и добавить `minRating?: number` в тип `opts` функции `searchExHentai`.

Вынести общий помощник (используется и в `searchExHentai`, и в `fetchEhPopular`), заменив в `searchExHentai` блок от `const r = await httpFetch(...)` до `return results` на вызов:

```ts
async function ehFetchListing(
  url: string, base: string,
  o: { cookieHeader: string; proxy?: string; ua: string; gdataApiBase: string }
): Promise<ExSearchResult[]> {
  const r = await httpFetch({
    url,
    headers: {
      'User-Agent': o.ua, Referer: `${base}/`, Accept: 'text/html,application/xhtml+xml',
      ...(o.cookieHeader ? { Cookie: o.cookieHeader } : {})
    },
    timeoutMs: o.proxy ? 120_000 : 30_000,
    frontOnEmpty: true
  }, o.proxy)

  if (looksRateLimited(r.status, r.text)) throw new Error('Сайт временно заблокировал IP за слишком частые запросы (excessive request rate). Подожди минуту-другую и попробуй снова.')
  const ehErr = ehErrorFromResponse(r.status, r.text)
  if (ehErr) throw new Error(`ExHentai: ${ehErr}`)
  if (r.status >= 400) throw new Error(`ExHentai: HTTP ${r.status}`)

  const results = parseExHentaiListing(r.text, base)
  if (results.length === 0) {
    const lower = r.text.toLowerCase()
    if (lower.includes('sad panda') || lower.includes('sorry, your ip') || lower.includes('ip has been banned')) {
      throw new Error('ExHentai: sad panda — аккаунт/IP без доступа к ExHentai или вход не выполнен')
    }
    if (!r.text.includes('table') && r.text.length < 4000) throw new Error('ExHentai: страница пуста или требует входа (sad panda / логин)')
    throw new Error('ExHentai: ничего не найдено (или куки не действительны / сайт изменил вёрстку)')
  }
  try {
    const meta = await fetchGData(
      results.map((x) => extractGidToken(x.url)).filter((x): x is { gid: string; token: string } => !!x),
      { apiBase: o.gdataApiBase, cookieHeader: o.cookieHeader, proxy: o.proxy, timeoutMs: o.proxy ? 120_000 : 20_000 }
    )
    const byGid = new Map(meta.map((m) => [m.gid, m]))
    for (const x of results) {
      const gid = extractGid(x.url); const m = gid ? byGid.get(gid) : undefined
      if (!m) continue
      if (m.category) x.category = m.category
      const rc = Number(m.rating); if (!isNaN(rc) && rc > 0) x.rating = rc
      const fc = Number(m.filecount); if (!isNaN(fc) && fc > 0) x.pages = fc
    }
  } catch { /* best-effort */ }
  return results
}
```
и `searchExHentai` завершается:

```ts
  return await ehFetchListing(url, base, {
    cookieHeader: opts.cookieHeader, proxy, ua,
    gdataApiBase: opts.domainOverride ? 'https://api.e-hentai.org/api.php' : 'https://exhentai.org/api.php'
  })
```

Добавить `fetchEhPopular`:

```ts
export async function fetchEhPopular(
  source: 'ehentai' | 'exhentai' | 'exhentai_onion',
  opts: { cookieHeader: string; torSocksAddr: string; exProxyAddr?: string; torProxied: boolean }
): Promise<ExSearchResult[]> {
  const useOnion = source === 'exhentai_onion'
  const base = useOnion
    ? 'http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion'
    : source === 'ehentai' ? 'https://e-hentai.org' : 'https://exhentai.org'
  const useProxy = useOnion || opts.torProxied
  const proxy = useProxy ? opts.torSocksAddr : (opts.exProxyAddr?.trim() || undefined)
  const ua = useProxy ? TOR_UA : UA
  return await ehFetchListing(`${base}/popular`, base, {
    cookieHeader: opts.cookieHeader, proxy, ua,
    gdataApiBase: source === 'ehentai' ? 'https://api.e-hentai.org/api.php' : 'https://exhentai.org/api.php'
  })
}
```

`src/shared/ipc.ts`: в `CatalogFilters` добавить `ehMinRating?: number`.

`src/main/index.ts` (ветка EH в `searchCatalog`): в вызов `searchExHentai(query, {...}, exProxy)` добавить `minRating: filters.ehMinRating`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/eh-search-params.test.ts && npm run typecheck && npm test`
Expected: PASS (существующие EH-тесты/парсер не сломаны).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/sources/eh.ts src/shared/ipc.ts src/main/index.ts tests/eh-search-params.test.ts
git commit -m "feat(eh): min-rating (f_srdd) param and fetchEhPopular via shared listing helper"
```

---

### Task 3: IPC `catalog:popular` + preload + EH min-rating в фильтрах

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Test: `tests/ipc-popular.test.ts`

**Interfaces:**
- Consumes: `fetchEhPopular` (Task 2), `CatalogFilters.ehMinRating` (Task 2).
- Produces: `CH.catalogPopular = 'catalog:popular'`; `Api.catalogPopular(source: 'ehentai'|'exhentai'|'exhentai_onion'): Promise<CatalogCard[]>`.

- [ ] **Step 1: Write the failing test**

`tests/ipc-popular.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CH } from '../src/shared/ipc'

describe('popular IPC', () => {
  it('exposes channel', () => {
    expect(CH.catalogPopular).toBe('catalog:popular')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ipc-popular.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/shared/ipc.ts`:
- `Api` + `catalogPopular(source: 'ehentai' | 'exhentai' | 'exhentai_onion'): Promise<CatalogCard[]>`.
- `CH` + `catalogPopular: 'catalog:popular'`.

`src/preload/index.ts`:
```ts
  catalogPopular: (source) => ipcRenderer.invoke(CH.catalogPopular, source),
```

`src/main/index.ts` (рядом с `searchCatalog`):
```ts
  ipcMain.handle(CH.catalogPopular, async (_e, source: 'ehentai' | 'exhentai' | 'exhentai_onion') => {
    const s = settings.get()
    if (s.builtin_tor && !embeddedTorSocks()) {
      try { await whenEmbeddedTorReady(120_000) } catch { /* fall through */ }
    }
    const torSocks = effectiveTorSocks()
    const useOnion = source === 'exhentai_onion'
    const torProxied = useOnion || s.tor_proxied_sites.includes('ehentai') || s.tor_proxied_sites.includes('exhentai')
    const cookieHeader = useOnion ? s.onion_cookies_raw : exAccounts.currentCookieHeader()
    const ex = await fetchEhPopular(source, {
      cookieHeader, torSocksAddr: torSocks, exProxyAddr: s.exhentai_proxy_addr, torProxied
    })
    return ex.map((c) => ({ url: c.url, title: c.title, coverUrl: c.coverUrl, pages: c.pages, score: c.rating, kind: c.category }))
  })
```
Импорт: `import { fetchEhPopular } from './services/sources/eh'` (или через catalog-search фасад — использовать прямой импорт).

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/ipc-popular.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts tests/ipc-popular.test.ts
git commit -m "feat(popular): IPC catalog:popular + preload"
```

---

### Task 4: Экран «Популярное» + сайдбар

**Files:**
- Create: `src/renderer/src/screens/Popular.tsx`
- Modify: `src/renderer/src/state/store.tsx`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/App.tsx`
- Test: ручной (UI)

**Interfaces:**
- Consumes: `window.api.catalogPopular` (Task 3), `CatalogCard`, `MangaCardGrid`.

- [ ] **Step 1: `store.tsx`** — `Screen` + `'Popular'`.

- [ ] **Step 2: `Sidebar.tsx`** — пункт `{ key: 'Popular', icon: '\u{1F525}', label: 'Popular' }` (расширить union).

- [ ] **Step 3: `App.tsx`** — `import Popular from './screens/Popular'; ... {screen === 'Popular' && <Popular />}`.

- [ ] **Step 4: `screens/Popular.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { CatalogCard } from '@shared/ipc'
import MangaCardGrid from '../components/MangaCardGrid'

type PopularSource = 'ehentai' | 'exhentai' | 'exhentai_onion'
const SOURCES: { key: PopularSource; label: string }[] = [
  { key: 'exhentai', label: 'ExHentai' },
  { key: 'ehentai', label: 'E-Hentai' },
  { key: 'exhentai_onion', label: 'ExHentai (onion)' }
]

export default function Popular(): JSX.Element {
  const { setScreen, setOpened, settings } = useStore()
  const [source, setSource] = useState<PopularSource>(settings.show_r34_history ? 'exhentai' : 'ehentai')
  const [cards, setCards] = useState<CatalogCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setCards(await window.api.catalogPopular(source))
    } catch (e: any) {
      setCards([]); setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => { void load() }, [load])

  const open = async (c: CatalogCard): Promise<void> => {
    const r = await window.api.openUrl(c.url, 0, null, c.coverUrl)
    if (r) { setOpened({ kind: 'online', ...r, startPage: 0, coverUrl: c.coverUrl }); setScreen('Reader') }
  }

  return (
    <div className="screen catalog">
      <div className="catalog-toolbar">
        <select value={source} onChange={(e) => setSource(e.target.value as PopularSource)}>
          {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button disabled={loading} onClick={() => void load()}>Обновить</button>
      </div>
      {error && <div className="error-text">{error}</div>}
      {loading && cards.length === 0 && <div className="muted">Загрузка…</div>}
      {cards.length > 0 && <MangaCardGrid cards={cards} onSelect={(c) => void open(c)} />}
      {!loading && !error && cards.length === 0 && <div className="muted">Пусто</div>}
    </div>
  )
}
```

- [ ] **Step 5: Проверка + коммит**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/renderer/src/screens/Popular.tsx src/renderer/src/state/store.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx
git commit -m "feat(popular): Popular screen + sidebar tab"
```

---

### Task 5: UI пресетов быстрого поиска в каталоге

**Files:**
- Modify: `src/renderer/src/screens/Catalog.tsx`, `src/renderer/src/styles.css`
- Test: ручной (UI)

**Interfaces:**
- Consumes: `Settings.quick_searches` (Task 1), `addQuickSearch/removeQuickSearch/moveQuickSearch`.

- [ ] **Step 1: Импорт хелперов**

```tsx
import { addQuickSearch, removeQuickSearch, moveQuickSearch } from '@shared/quick-search'
```

- [ ] **Step 2: Кнопка + выпадающий список в тулбаре**

В `catalog-toolbar` (после `<button onClick={() => void search(0)}>Найти</button>`) добавить:

```tsx
        <div className="quick-search">
          <button className="tab" onClick={() => setQsOpen((v) => !v)}>★ Быстрые поиски ▾</button>
          {qsOpen && (
            <div className="quick-search-menu">
              {settings.quick_searches.length === 0 && <div className="muted qs-empty">Нет сохранённых поисков</div>}
              {settings.quick_searches.map((q, i) => (
                <div key={q.id} className="qs-row">
                  <button className="qs-launch" title={`${q.source}: ${q.query}`} onClick={() => {
                    setQsOpen(false)
                    changeSource(q.source)
                    setQuery(q.query)
                    setTimeout(() => void search(0), 0)
                  }}>{q.name}</button>
                  <button className="qs-icon" disabled={i === 0} onClick={() => setSettings({ ...settings, quick_searches: moveQuickSearch(settings.quick_searches, q.id, 'up') })}>↑</button>
                  <button className="qs-icon" disabled={i === settings.quick_searches.length - 1} onClick={() => setSettings({ ...settings, quick_searches: moveQuickSearch(settings.quick_searches, q.id, 'down') })}>↓</button>
                  <button className="qs-icon" onClick={() => setSettings({ ...settings, quick_searches: removeQuickSearch(settings.quick_searches, q.id) })}>✕</button>
                </div>
              ))}
              <button className="qs-save" onClick={() => {
                const name = window.prompt('Название быстрого поиска', query.trim() || source)
                if (!name) return
                setSettings({
                  ...settings,
                  quick_searches: addQuickSearch(settings.quick_searches, {
                    id: crypto.randomUUID(), name, source, query
                  })
                })
                setQsOpen(false)
              }}>＋ Сохранить текущий поиск</button>
            </div>
          )}
        </div>
```

Добавить состояние: `const [qsOpen, setQsOpen] = useState(false)` (рядом с прочими `useState`).

> `changeSource(s)` уже существует и ставит источник+`last_catalog_source`. `setQuery` — существующий сеттер поисковой строки. `search(0)` запускает поиск. Порядок: `changeSource` меняет `source` асинхронно; `setTimeout(...,0)` даёт `search` увидеть новый `source` через свежий `searchRef.current`.

- [ ] **Step 3: Стили**

```css
.quick-search { position: relative; }
.quick-search-menu { position: absolute; right: 0; top: 100%; z-index: 30; min-width: 240px; background: #141414; border: 1px solid var(--border); border-radius: 6px; padding: 4px; box-shadow: 0 8px 24px rgba(0,0,0,.6); }
.qs-row { display: flex; align-items: center; gap: 4px; }
.qs-launch { flex: 1; text-align: left; background: transparent; border: none; color: var(--text); padding: 5px 8px; border-radius: 4px; cursor: pointer; }
.qs-launch:hover { background: #1e1410; color: var(--accent); }
.qs-icon { padding: 4px 6px; }
.qs-save { width: 100%; margin-top: 4px; }
.qs-empty { padding: 6px 8px; }
```

- [ ] **Step 4: Проверка + коммит**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/renderer/src/screens/Catalog.tsx src/renderer/src/styles.css
git commit -m "feat(search): quick-search presets UI in catalog"
```

---

### Task 6: Финальная проверка

- [ ] **Step 1: Полный прогон**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 2: Ручной smoke**

- Каталог → «★ Быстрые поиски» → «＋ Сохранить текущий поиск» → переключить источник → выбрать пресет (возвращает источник+запрос, ищет).
- Сайдбар → «Популярное» → список с ранклиста (учитывает Tor/аккаунт), рейтинг на карточках, открытие работает.
- E-Hentai/ExHentai фильтры → «Мин. рейтинг: 3+» → результаты отфильтрованы.

- [ ] **Step 3: Commit (если остались правки)**

```bash
git status --short
git add -A
git commit -m "chore: manual smoke fixes for quick-search/popular/rating"
```

---

## Self-Review

**Покрытие спеки:** Ф-1 (пресеты) → Tasks 1, 5; Ф-2 (популярное) → Tasks 2, 3, 4; Ф-3 (мин. рейтинг) → Tasks 2, 3 (фильтр в Catalog UI — часть Task 2 по типам; UI-селект добавить в Catalog — см. ниже). Риск: UI-селект «мин. рейтинг» в Catalog не выделен отдельным шагом — добавить в Task 5 (Catalog) вместе со стилями.

**Уточнение Task 5:** добавить в панель EH-фильтров (`{tagSource && (...)}` блок) селект:

```tsx
                <div className="filter-title">Мин. рейтинг</div>
                <select className="filter-select" value={String(ehMinRating)} onChange={(e) => setEhMinRating(Number(e.target.value))}>
                  <option value="0">Любой</option>
                  <option value="2">2+</option>
                  <option value="3">3+</option>
                  <option value="4">4+</option>
                  <option value="5">5</option>
                </select>
```
со стейтом `const [ehMinRating, setEhMinRating] = useState(0)` и включением `ehMinRating` в объект `filters` (`ehMinRating`), и в `resetFilters()` (`setEhMinRating(0)`).

**Типы:** `QuickSearch` (Task 1) используется в Settings/UI; `CatalogFilters.ehMinRating` (Task 2) — в Catalog и main; `fetchEhPopular`/`buildEhSearchParams` — Task 2. Плейсхолдеров нет.
