# Библиотека + бэкап + SQLite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить экран «Библиотека» (статусы чтения, заметки, оценка, теги) с хранением истории и библиотеки в SQLite, и экспорт/импорт всех данных одним JSON-файлом.

**Architecture:** Одна таблица `series` (история = все строки, библиотека = `status IS NOT NULL`). Доступ через интерфейс `SeriesRepository`: `SqliteSeriesRepository` (better-sqlite3) в приложении, `InMemorySeriesRepository` в тестах — это обходит конфликт ABI Node/Electron. `HistoryManager` становится обёрткой над репозиторием, `LibraryService` — логика библиотеки, `backup.ts` — экспорт/импорт.

**Tech Stack:** TypeScript, Electron 33, React 18, better-sqlite3, vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-library-backup-sqlite-design.md`

## Global Constraints

- Вся работа с БД и файлами — только в main-процессе; renderer — только через типизированный IPC (`src/shared/ipc.ts`).
- `better-sqlite3` импортируется **единственным** модулем `src/main/services/db.ts`. Тесты vitest не должны импортировать его (конфликт ABI).
- Русские пользовательские сообщения об ошибках.
- `settings.json`, `downloads.json`, `pin.json` остаются JSON; в SQLite уезжают только история и библиотека.
- Статусы: `reading | planned | completed | on_hold | dropped`.
- Секреты (куки, прокси-адреса, `tor_bridges`, аккаунты) не попадают в бэкап без явной галочки; PIN не экспортируется никогда.
- После каждого таска: `npm run typecheck && npm test` должны проходить.
- Тесты — `tests/`, vitest, node environment; `@shared` алиас настроен.

---

### Task 1: `series-key.ts` — чистые функции ключей

**Files:**
- Create: `src/main/services/series-key.ts`
- Modify: `src/main/services/history.ts`
- Test: `tests/history.test.ts` (существующий — должен проходить без правок)

**Interfaces:**
- Consumes: ничего.
- Produces: `galleryKeyForUrl(url: string): string | null`, `seriesKeyForUrl(url: string): string | null`, `sourceLabelForUrl(url: string): string`.

- [ ] **Step 1: Создать `series-key.ts`**

Перенести дословно из `src/main/services/history.ts` три функции: `sourceLabelForUrl` (строки 17–30), `galleryKeyForUrl` (36–43), `seriesKeyForUrl` (49–93). Добавить `import { mangaSeriesUrlFromChapterUrl } from './sources'`.

```ts
import { mangaSeriesUrlFromChapterUrl } from './sources'

export function sourceLabelForUrl(url: string): string {
  const lower = url.toLowerCase()
  if (lower.startsWith('file://')) return 'Локальная папка'
  if (lower.includes('mangadex') || (!lower.startsWith('http') && url.length === 36)) return 'MangaDex'
  if (lower.includes('exhentai')) return 'ExHentai'
  if (lower.includes('e-hentai.org')) return 'E-Hentai'
  if (lower.includes('nhentai')) return 'NHentai'
  if (lower.includes('com-x.life')) return 'Com-X'
  if (lower.includes('senkuro.')) return 'Senkuro'
  if (lower.includes('manga-shi.')) return 'Manga-shi'
  if (lower.includes('remanga.')) return 'Remanga'
  if (lower.includes('mangalib.')) return 'Mangalib'
  return ''
}

export function galleryKeyForUrl(url: string): string | null {
  const lower = url.toLowerCase()
  const gid = lower.match(/\/g\/(\d+)(\/[0-9a-f]+)?\/?/)?.[1]
  if (!gid) return null
  if (/exhentai|e-hentai\.org/.test(lower)) return `eh:${gid}`
  if (/nhentai/.test(lower)) return `nh:${gid}`
  return null
}

export function seriesKeyForUrl(url: string): string | null {
  const raw = String(url ?? '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.startsWith('file:')) return `local:${lower.replace(/\/+$/, '')}`
  const gallery = galleryKeyForUrl(raw)
  if (gallery) return gallery
  const uuid = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
  if (uuid) return `md:${uuid.toLowerCase()}`

  try {
    const u = new URL(raw)
    const host = u.hostname.replace(/^www\./, '').toLowerCase()
    const segs = u.pathname.split('/').filter(Boolean)
      .map((s) => decodeURIComponent(s).toLowerCase())

    const afterMarker = (marker: string): string | null => {
      const i = segs.findIndex((s) => s.toLowerCase() === marker)
      return i >= 0 && segs[i + 1] ? segs[i + 1] : null
    }

    if (/mangadex/.test(host)) {
      const u2 = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      return `md:${u2?.[0] ?? afterMarker('title') ?? segs[segs.length - 1] ?? ''}`
    }
    if (/mangamello/.test(host)) return `me:${afterMarker('manga') ?? afterMarker('mangas') ?? ''}`
    if (/senkuro\./.test(host)) return `sk:${afterMarker('manga') ?? ''}`
    if (/manga-shi\./.test(host)) return `ms:${afterMarker('manga') ?? ''}`
    if (/remanga\./.test(host)) return `rm:${afterMarker('manga') ?? ''}`
    if (/mangalib|^libmir|^chzz/.test(host)) return `ml:${afterMarker('manga') ?? segs[segs.length - 1] ?? ''}`
    if (/com-x/.test(host)) {
      const readerNews = raw.match(/\/reader\/(\d+)/)?.[1]
      const catalogNews = raw.match(/\/(?:online\/)?(\d+)-[\w-]+\.html/i)?.[1]
      return `cx:${readerNews ?? catalogNews ?? ''}`
    }
    if (/readmanga|^mintmanga|mangapoisk/.test(host)) return `gr:${segs[0] ?? ''}`
  } catch { /* not URL-shaped */ }
  return null
}
```

- [ ] **Step 2: Переключить `history.ts` на импорт и ре-экспорт**

В `src/main/services/history.ts` удалить тела трёх функций, добавить сверху:

```ts
import { galleryKeyForUrl, seriesKeyForUrl, sourceLabelForUrl } from './series-key'
export { galleryKeyForUrl, seriesKeyForUrl, sourceLabelForUrl } from './series-key'
```

Оставить импорт `mangaSeriesUrlFromChapterUrl` (он ещё нужен в `load`).

- [ ] **Step 3: Прогнать существующие тесты**

Run: `npx vitest run tests/history.test.ts`
Expected: PASS (тесты импортируют `galleryKeyForUrl`/`seriesKeyForUrl` из `history.ts` через ре-экспорт).

- [ ] **Step 4: Commit**

```bash
git add src/main/services/series-key.ts src/main/services/history.ts
git commit -m "refactor: extract series-key helpers from history service"
```

---

### Task 2: Типы библиотеки + настройка авто-добавления

**Files:**
- Create: `src/shared/library.ts`
- Modify: `src/shared/settings.ts`
- Test: `tests/library-types.test.ts`

**Interfaces:**
- Produces:
  - `ReadingStatus`, `READING_STATUSES`, `LibraryItem`, `SeriesUpsert`, `LibrarySort`, `LibraryQuery`.
  - `Settings.library_auto_add: boolean` (default `true`).

- [ ] **Step 1: Написать тест**

`tests/library-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { READING_STATUSES } from '../src/shared/library'
import { defaultSettings, parseSettings } from '../src/shared/settings'

describe('library types', () => {
  it('exposes the five statuses', () => {
    expect(READING_STATUSES).toEqual(['reading', 'planned', 'completed', 'on_hold', 'dropped'])
  })
})

describe('settings.library_auto_add', () => {
  it('defaults true and parses booleans', () => {
    expect(defaultSettings().library_auto_add).toBe(true)
    expect(parseSettings({ library_auto_add: false }).library_auto_add).toBe(false)
    expect(parseSettings({}).library_auto_add).toBe(true)
  })
})
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx vitest run tests/library-types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Создать `src/shared/library.ts`**

```ts
export type ReadingStatus = 'reading' | 'planned' | 'completed' | 'on_hold' | 'dropped'

export const READING_STATUSES: ReadingStatus[] = ['reading', 'planned', 'completed', 'on_hold', 'dropped']

export interface LibraryItem {
  key: string
  seriesId: string
  url: string
  title: string
  coverUrl: string | null
  source: string
  category: string
  currentPage: number
  totalPages: number
  chapterLabel: string | null
  chapterIndex: number | null
  chapterTotal: number | null
  status: ReadingStatus | null
  note: string
  rating: number | null
  tags: string[]
  openedAt: number
  createdAt: number
  updatedAt: number
}

export interface SeriesUpsert {
  key: string
  seriesId: string
  url: string
  title: string
  coverUrl: string | null
  source: string
  category: string
  currentPage: number
  totalPages: number
  chapterLabel: string | null
  chapterIndex: number | null
  chapterTotal: number | null
  openedAt?: number
  createdAt?: number
}

export type LibrarySort = 'last_read' | 'title' | 'rating' | 'added'

export interface LibraryQuery {
  status?: ReadingStatus | 'all'
  search?: string
  sort?: LibrarySort
  includeR34?: boolean
}
```

- [ ] **Step 4: Добавить `library_auto_add` в settings**

В `src/shared/settings.ts`:
- в интерфейс `Settings` добавить `library_auto_add: boolean` (после `last_catalog_source`);
- в `defaultSettings()` добавить `library_auto_add: true`;
- в `parseSettings()` добавить `library_auto_add: bool(o.library_auto_add, true)`.

- [ ] **Step 5: Запустить — должен пройти**

Run: `npx vitest run tests/library-types.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/library.ts src/shared/settings.ts tests/library-types.test.ts
git commit -m "feat(library): shared types and library_auto_add setting"
```

---

### Task 3: `SeriesRepository` + `InMemorySeriesRepository`

**Files:**
- Create: `src/main/services/series-repository.ts`
- Test: `tests/series-repository.test.ts`

**Interfaces:**
- Consumes: `LibraryItem`, `SeriesUpsert`, `ReadingStatus`, `LibraryQuery` (Task 2).
- Produces: интерфейс `SeriesRepository`, абстрактный `BaseSeriesRepository` (реализует `list`/`countByStatus` через `all()`), класс `InMemorySeriesRepository`.

- [ ] **Step 1: Написать тест**

`tests/series-repository.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { InMemorySeriesRepository } from '../src/main/services/series-repository'
import type { SeriesUpsert } from '../src/shared/library'

const up = (over: Partial<SeriesUpsert> = {}): SeriesUpsert => ({
  key: 'nh:1', seriesId: 'nh:1', url: 'https://nhentai.net/g/1/', title: 'A',
  coverUrl: null, source: 'NHentai', category: 'r34',
  currentPage: 1, totalPages: 10, chapterLabel: null, chapterIndex: null, chapterTotal: null,
  ...over
})

describe('InMemorySeriesRepository', () => {
  it('upserts history and preserves library fields', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up())
    r.setStatus('nh:1', 'reading')
    r.setNote('nh:1', 'hello')
    r.upsertHistory(up({ currentPage: 5, totalPages: 12 }))
    const it = r.get('nh:1')!
    expect(it.status).toBe('reading')
    expect(it.note).toBe('hello')
    expect(it.currentPage).toBe(5)
    expect(it.totalPages).toBe(12)
  })

  it('takes max progress and fills missing cover', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ currentPage: 7, totalPages: 10, coverUrl: 'c1' }))
    r.upsertHistory(up({ currentPage: 3, totalPages: 20, coverUrl: null }))
    const it = r.get('nh:1')!
    expect(it.currentPage).toBe(7)
    expect(it.totalPages).toBe(20)
    expect(it.coverUrl).toBe('c1')
  })

  it('list returns only library items and filters', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'nh:1', title: 'Alpha' }))
    r.upsertHistory(up({ key: 'nh:2', title: 'Beta' }))
    r.setStatus('nh:2', 'planned')
    expect(r.list({ status: 'all' }).map((i) => i.key)).toEqual(['nh:2'])
    expect(r.list({ status: 'planned' }).map((i) => i.key)).toEqual(['nh:2'])
    expect(r.list({ status: 'reading' })).toHaveLength(0)
  })

  it('respects includeR34=false and search/sort', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'a:1', url: 'https://a/1', title: 'Zeta', category: 'main' }))
    r.upsertHistory(up({ key: 'nh:2', title: 'Beta', category: 'r34' }))
    r.setStatus('a:1', 'completed')
    r.setStatus('nh:2', 'reading')
    expect(r.list({ status: 'all', includeR34: false }).map((i) => i.key)).toEqual(['a:1'])
    expect(r.list({ status: 'all', search: 'bet' }).map((i) => i.key)).toEqual(['nh:2'])
    expect(r.list({ status: 'all', sort: 'title' }).map((i) => i.title)).toEqual(['Beta', 'Zeta'])
  })

  it('clearHistory keeps library rows', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'nh:1' }))
    r.upsertHistory(up({ key: 'nh:2' }))
    r.setStatus('nh:2', 'reading')
    r.clearHistory()
    expect(r.get('nh:1')).toBeNull()
    expect(r.get('nh:2')).not.toBeNull()
  })

  it('counts by status', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'nh:1' }))
    r.upsertHistory(up({ key: 'nh:2' }))
    r.setStatus('nh:1', 'reading')
    r.setStatus('nh:2', 'reading')
    expect(r.countByStatus()).toEqual({ reading: 2 })
  })

  it('importItems merges by newest updatedAt', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'nh:1', title: 'Old' }))
    const base = r.get('nh:1')!
    const res = r.importItems([
      { ...base, title: 'Newer', updatedAt: base.updatedAt + 1000 },
      { ...base, key: 'nh:9', title: 'Fresh', updatedAt: base.updatedAt }
    ])
    expect(res).toEqual({ added: 1, updated: 1 })
    expect(r.get('nh:1')!.title).toBe('Newer')
    expect(r.get('nh:9')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx vitest run tests/series-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Создать `src/main/services/series-repository.ts`**

```ts
import type { LibraryItem, SeriesUpsert, ReadingStatus, LibraryQuery } from '@shared/library'

export interface SeriesRepository {
  all(): LibraryItem[]
  get(key: string): LibraryItem | null
  findByUrl(url: string): LibraryItem | null
  upsertHistory(item: SeriesUpsert): LibraryItem
  updateProgress(key: string, currentPage: number, totalPages: number, openedAt: number): void
  setStatus(key: string, status: ReadingStatus | null): void
  setNote(key: string, note: string): void
  setRating(key: string, rating: number | null): void
  setTags(key: string, tags: string[]): void
  delete(key: string): void
  clearHistory(): void
  list(query: LibraryQuery): LibraryItem[]
  countByStatus(): Record<string, number>
  importItems(items: LibraryItem[]): { added: number; updated: number }
}

function clone(i: LibraryItem): LibraryItem {
  return { ...i, tags: [...i.tags] }
}

export abstract class BaseSeriesRepository implements SeriesRepository {
  abstract all(): LibraryItem[]
  abstract get(key: string): LibraryItem | null
  abstract findByUrl(url: string): LibraryItem | null
  abstract upsertHistory(item: SeriesUpsert): LibraryItem
  abstract updateProgress(key: string, currentPage: number, totalPages: number, openedAt: number): void
  abstract setStatus(key: string, status: ReadingStatus | null): void
  abstract setNote(key: string, note: string): void
  abstract setRating(key: string, rating: number | null): void
  abstract setTags(key: string, tags: string[]): void
  abstract delete(key: string): void
  abstract clearHistory(): void
  abstract importItems(items: LibraryItem[]): { added: number; updated: number }

  list(query: LibraryQuery): LibraryItem[] {
    let items = this.all().filter((i) => i.status !== null)
    if (query.includeR34 === false) items = items.filter((i) => i.category !== 'r34')
    if (query.status && query.status !== 'all') items = items.filter((i) => i.status === query.status)
    const q = query.search?.trim().toLowerCase()
    if (q) items = items.filter((i) => i.title.toLowerCase().includes(q))
    const sort = query.sort ?? 'last_read'
    return [...items].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title)
      if (sort === 'rating') return (b.rating ?? 0) - (a.rating ?? 0)
      if (sort === 'added') return b.createdAt - a.createdAt
      return b.openedAt - a.openedAt
    })
  }

  countByStatus(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const i of this.all()) {
      if (!i.status) continue
      out[i.status] = (out[i.status] ?? 0) + 1
    }
    return out
  }
}

export class InMemorySeriesRepository extends BaseSeriesRepository {
  private map = new Map<string, LibraryItem>()

  constructor(seed: LibraryItem[] = []) {
    super()
    for (const i of seed) this.map.set(i.key, clone(i))
  }

  all(): LibraryItem[] {
    return [...this.map.values()].map(clone)
  }

  get(key: string): LibraryItem | null {
    const v = this.map.get(key)
    return v ? clone(v) : null
  }

  findByUrl(url: string): LibraryItem | null {
    for (const v of this.map.values()) if (v.url === url) return clone(v)
    return null
  }

  upsertHistory(item: SeriesUpsert): LibraryItem {
    const now = Date.now()
    const existing = this.map.get(item.key)
    if (existing) {
      const next: LibraryItem = {
        ...existing,
        ...item,
        coverUrl: item.coverUrl ?? existing.coverUrl,
        currentPage: Math.max(existing.currentPage, item.currentPage),
        totalPages: Math.max(existing.totalPages, item.totalPages),
        openedAt: item.openedAt ?? now,
        createdAt: existing.createdAt,
        updatedAt: now
      }
      this.map.set(item.key, next)
      return clone(next)
    }
    const row: LibraryItem = {
      ...item,
      status: null, note: '', rating: null, tags: [],
      openedAt: item.openedAt ?? now,
      createdAt: item.createdAt ?? now,
      updatedAt: now
    }
    this.map.set(item.key, row)
    return clone(row)
  }

  updateProgress(key: string, currentPage: number, totalPages: number, openedAt: number): void {
    const e = this.map.get(key)
    if (!e) return
    e.currentPage = currentPage
    e.totalPages = Math.max(e.totalPages, totalPages)
    e.openedAt = openedAt
    e.updatedAt = Date.now()
  }

  private patch(key: string, p: Partial<LibraryItem>): void {
    const e = this.map.get(key)
    if (!e) return
    Object.assign(e, p, { updatedAt: Date.now() })
  }

  setStatus(key: string, status: ReadingStatus | null): void { this.patch(key, { status }) }
  setNote(key: string, note: string): void { this.patch(key, { note }) }
  setRating(key: string, rating: number | null): void { this.patch(key, { rating }) }
  setTags(key: string, tags: string[]): void { this.patch(key, { tags: [...tags] }) }

  delete(key: string): void { this.map.delete(key) }

  clearHistory(): void {
    for (const [k, v] of this.map) if (v.status === null) this.map.delete(k)
  }

  importItems(items: LibraryItem[]): { added: number; updated: number } {
    let added = 0
    let updated = 0
    for (const item of items) {
      const cur = this.map.get(item.key)
      if (!cur) { this.map.set(item.key, clone(item)); added++; continue }
      if (item.updatedAt > cur.updatedAt) { this.map.set(item.key, clone(item)); updated++ }
    }
    return { added, updated }
  }
}
```

- [ ] **Step 4: Запустить — должен пройти**

Run: `npx vitest run tests/series-repository.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/series-repository.ts tests/series-repository.test.ts
git commit -m "feat(library): series repository interface and in-memory implementation"
```

---

### Task 4: Рефактор `HistoryManager` на репозиторий

**Files:**
- Modify: `src/main/services/history.ts`
- Test: `tests/history.test.ts` (существующий — без правок), `tests/history-repo.test.ts` (новый)

**Interfaces:**
- Consumes: `SeriesRepository`, `InMemorySeriesRepository` (Task 3); `series-key` (Task 1).
- Produces: `HistoryManager` с конструктором `new HistoryManager(repo?: SeriesRepository)`; экспорт `normalizeHistory(entries: HistoryEntry[]): SeriesUpsert[]`.

- [ ] **Step 1: Написать тест write-through**

`tests/history-repo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { HistoryManager } from '../src/main/services/history'
import { InMemorySeriesRepository } from '../src/main/services/series-repository'

const base = {
  title: 't', cover_url: null, source: 'NHentai', chapter_label: null,
  chapter_index: null, chapter_total: null, category: 'r34'
}

describe('HistoryManager writes through to the repository', () => {
  it('persists into the repo passed to the constructor', () => {
    const repo = new InMemorySeriesRepository()
    const m = new HistoryManager(repo)
    m.load([{ ...base, url: 'https://nhentai.net/g/7/', series_id: 'https://nhentai.net/g/7/', current_page: 2, total_pages: 10, opened_at: 1000 }])
    expect(repo.get('nh:7')).not.toBeNull()
    expect(repo.get('nh:7')!.currentPage).toBe(2)
  })

  it('updateProgress writes to the repo', () => {
    const repo = new InMemorySeriesRepository()
    const m = new HistoryManager(repo)
    m.addOrUpdate({ ...base, url: 'https://nhentai.net/g/7/', series_id: 'https://nhentai.net/g/7/', current_page: 1, total_pages: 10 } as any)
    m.updateProgress('https://nhentai.net/g/7/', 4, 10)
    expect(repo.get('nh:7')!.currentPage).toBe(4)
  })

  it('does not reseed when the repo already has rows', () => {
    const repo = new InMemorySeriesRepository()
    new HistoryManager(repo).load([{ ...base, url: 'https://nhentai.net/g/7/', series_id: 'x', current_page: 1, total_pages: 1, opened_at: 1 }])
    const m2 = new HistoryManager(repo)
    m2.load([{ ...base, url: 'https://nhentai.net/g/99/', series_id: 'y', current_page: 1, total_pages: 1, opened_at: 2 }])
    expect(repo.get('nh:99')).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx vitest run tests/history-repo.test.ts`
Expected: FAIL (нет экспорта / конструктор не принимает repo).

- [ ] **Step 3: Переписать `HistoryManager`**

Заменить класс `HistoryManager` в `src/main/services/history.ts` (типы `HistoryEntry`, `HistoryUpdate`, `normalizeHistory`, `toHistoryEntry`, `toUpsert` — ниже). Импорты: `import { InMemorySeriesRepository, type SeriesRepository } from './series-repository'`, `import type { LibraryItem, SeriesUpsert } from '@shared/library'`, `import { seriesKeyForUrl } from './series-key'`.

```ts
export function normalizeHistory(entries: HistoryEntry[]): SeriesUpsert[] {
  const normalized = entries.map((e) => {
    const seriesId = e.series_id || e.url
    const key = seriesKeyForUrl(e.url) ?? mangaSeriesUrlFromChapterUrl(seriesId) ?? seriesId
    return { e, key }
  })
  normalized.sort((a, b) => b.e.opened_at - a.e.opened_at)
  const byKey = new Map<string, SeriesUpsert>()
  for (const { e, key } of normalized) {
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        key, seriesId: e.series_id || e.url, url: e.url, title: e.title,
        coverUrl: e.cover_url, source: e.source, category: e.category,
        currentPage: e.current_page, totalPages: e.total_pages,
        chapterLabel: e.chapter_label, chapterIndex: e.chapter_index, chapterTotal: e.chapter_total,
        openedAt: e.opened_at, createdAt: e.opened_at
      })
      continue
    }
    existing.currentPage = Math.max(existing.currentPage, e.current_page)
    existing.totalPages = Math.max(existing.totalPages, e.total_pages)
    existing.coverUrl = existing.coverUrl ?? e.cover_url
    existing.chapterLabel = existing.chapterLabel ?? e.chapter_label
    existing.chapterIndex = existing.chapterIndex ?? e.chapter_index
    existing.chapterTotal = existing.chapterTotal ?? e.chapter_total
    existing.openedAt = Math.max(existing.openedAt ?? 0, e.opened_at)
    existing.createdAt = Math.min(existing.createdAt ?? e.opened_at, e.opened_at)
  }
  return [...byKey.values()]
}

function toHistoryEntry(i: LibraryItem): HistoryEntry {
  return {
    url: i.url, series_id: i.seriesId, title: i.title, cover_url: i.coverUrl,
    source: i.source, chapter_label: i.chapterLabel, chapter_index: i.chapterIndex,
    chapter_total: i.chapterTotal, current_page: i.currentPage, total_pages: i.totalPages,
    category: i.category, opened_at: i.openedAt
  }
}

function toUpsert(u: HistoryUpdate, key: string, seriesId: string): SeriesUpsert {
  return {
    key, seriesId: seriesId || u.url, url: u.url, title: u.title, coverUrl: u.cover_url,
    source: u.source, category: u.category, currentPage: 1, totalPages: u.total_pages,
    chapterLabel: u.chapter_label, chapterIndex: u.chapter_index, chapterTotal: u.chapter_total,
    openedAt: Date.now()
  }
}

export class HistoryManager {
  private repo: SeriesRepository
  private entries: HistoryEntry[] = []

  constructor(repo: SeriesRepository = new InMemorySeriesRepository()) {
    this.repo = repo
    this.refresh()
  }

  private refresh(): void {
    this.entries = this.repo.all().map(toHistoryEntry).sort((a, b) => b.opened_at - a.opened_at)
  }

  load(raw: HistoryEntry[]): void {
    if (this.repo.all().length > 0 || raw.length === 0) { this.refresh(); return }
    for (const item of normalizeHistory(raw)) this.repo.upsertHistory(item)
    this.refresh()
  }

  all(): HistoryEntry[] { return this.entries.map((e) => ({ ...e })) }
  mainEntries(): HistoryEntry[] { return this.entries.filter((e) => e.category === 'main') }
  r34Entries(): HistoryEntry[] { return this.entries.filter((e) => e.category === 'r34') }
  toVec(): HistoryEntry[] { return this.all() }

  clear(): void {
    this.repo.clearHistory()
    this.refresh()
  }

  addOrUpdate(update: HistoryUpdate): void {
    const key = seriesKeyForUrl(update.url) ?? update.series_id ?? update.url
    const existing = this.repo.get(key) ?? this.repo.findByUrl(update.url)
    if (existing) {
      if (existing.url !== update.url && update.chapter_index != null && existing.chapterIndex != null && update.chapter_index < existing.chapterIndex) {
        return
      }
      const next = toUpsert(update, existing.key, existing.seriesId)
      if (existing.url === update.url) {
        next.currentPage = Math.max(existing.currentPage, 1)
        next.totalPages = Math.max(existing.totalPages, update.total_pages)
      } else {
        next.coverUrl = update.cover_url ?? existing.coverUrl
        next.currentPage = existing.currentPage
        next.totalPages = Math.max(existing.totalPages, update.total_pages)
      }
      this.repo.upsertHistory(next)
    } else {
      this.repo.upsertHistory(toUpsert(update, key, update.series_id || update.url))
    }
    this.refresh()
  }

  updateProgress(url: string, currentPage: number, totalPages: number): void {
    const key = seriesKeyForUrl(url)
    const item = this.repo.findByUrl(url) ?? (key ? this.repo.get(key) : null)
    if (item) this.repo.updateProgress(item.key, currentPage, totalPages, Date.now())
    this.refresh()
  }
}
```

Убедиться, что `HistoryUpdate` и `HistoryEntry` по-прежнему экспортируются/импортируются. `sourceLabelForUrl` ре-экспортируется из Task 1.

- [ ] **Step 4: Прогнать оба теста истории**

Run: `npx vitest run tests/history.test.ts tests/history-repo.test.ts && npm run typecheck`
Expected: PASS (включая старые тесты коллапса).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/history.ts tests/history-repo.test.ts
git commit -m "refactor(history): back HistoryManager with SeriesRepository (write-through)"
```

---

### Task 5: SQLite — `db.ts` + `SqliteSeriesRepository` + сборка

**Files:**
- Create: `src/main/services/sqlite-series-repository.ts`
- Create: `src/main/services/db.ts`
- Modify: `package.json`, `electron-builder.yml`
- Test: dev-smoke (ручной, вне vitest)

> `series-repository.ts` остаётся **чистым** (без `better-sqlite3`) — его импортируют тесты. SQLite-реализация живёт в отдельном файле, который тесты не трогают.

**Interfaces:**
- Consumes: `SeriesRepository`/`BaseSeriesRepository` (Task 3).
- Produces: `openDatabase(userDataDir: string): { db: Database.Database; repo: SqliteSeriesRepository }`.

- [ ] **Step 1: Установить зависимость и настроить сборку**

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

В `package.json` в `scripts` добавить:

```json
"postinstall": "electron-builder install-app-deps"
```

В `electron-builder.yml` в корень добавить:

```yaml
asarUnpack:
  - '**/node_modules/better-sqlite3/**'
```

- [ ] **Step 2: Создать `src/main/services/sqlite-series-repository.ts`**

```ts
import Database from 'better-sqlite3'
import { BaseSeriesRepository } from './series-repository'
import type { LibraryItem, SeriesUpsert, ReadingStatus } from '@shared/library'

interface SeriesRow {
  key: string; series_id: string; url: string; title: string; cover_url: string | null
  source: string | null; category: string; current_page: number; total_pages: number
  chapter_label: string | null; chapter_index: number | null; chapter_total: number | null
  status: ReadingStatus | null; note: string; rating: number | null; tags: string
  opened_at: number; created_at: number; updated_at: number
}

function rowToItem(r: SeriesRow): LibraryItem {
  let tags: string[] = []
  try { const p = JSON.parse(r.tags); if (Array.isArray(p)) tags = p.filter((x) => typeof x === 'string') } catch { /* ignore */ }
  return {
    key: r.key, seriesId: r.series_id, url: r.url, title: r.title, coverUrl: r.cover_url,
    source: r.source ?? '', category: r.category, currentPage: r.current_page, totalPages: r.total_pages,
    chapterLabel: r.chapter_label, chapterIndex: r.chapter_index, chapterTotal: r.chapter_total,
    status: r.status, note: r.note, rating: r.rating, tags,
    openedAt: r.opened_at, createdAt: r.created_at, updatedAt: r.updated_at
  }
}

export class SqliteSeriesRepository extends BaseSeriesRepository {
  constructor(private db: Database.Database) { super() }

  all(): LibraryItem[] {
    return (this.db.prepare('SELECT * FROM series').all() as SeriesRow[]).map(rowToItem)
  }

  get(key: string): LibraryItem | null {
    const r = this.db.prepare('SELECT * FROM series WHERE key = ?').get(key) as SeriesRow | undefined
    return r ? rowToItem(r) : null
  }

  findByUrl(url: string): LibraryItem | null {
    const r = this.db.prepare('SELECT * FROM series WHERE url = ? ORDER BY opened_at DESC LIMIT 1').get(url) as SeriesRow | undefined
    return r ? rowToItem(r) : null
  }

  upsertHistory(item: SeriesUpsert): LibraryItem {
    const now = Date.now()
    const existing = this.get(item.key)
    if (existing) {
      this.db.prepare(`
        UPDATE series SET series_id = @series_id, url = @url, title = @title,
          cover_url = @cover_url, source = @source, category = @category,
          current_page = @current_page, total_pages = @total_pages,
          chapter_label = @chapter_label, chapter_index = @chapter_index, chapter_total = @chapter_total,
          opened_at = @opened_at, updated_at = @updated_at
        WHERE key = @key
      `).run({
        key: item.key, series_id: item.seriesId, url: item.url, title: item.title,
        cover_url: item.coverUrl ?? existing.coverUrl, source: item.source, category: item.category,
        current_page: Math.max(existing.currentPage, item.currentPage),
        total_pages: Math.max(existing.totalPages, item.totalPages),
        chapter_label: item.chapterLabel, chapter_index: item.chapterIndex, chapter_total: item.chapterTotal,
        opened_at: item.openedAt ?? now, updated_at: now
      })
    } else {
      this.db.prepare(`
        INSERT INTO series (key, series_id, url, title, cover_url, source, category,
          current_page, total_pages, chapter_label, chapter_index, chapter_total,
          status, note, rating, tags, opened_at, created_at, updated_at)
        VALUES (@key, @series_id, @url, @title, @cover_url, @source, @category,
          @current_page, @total_pages, @chapter_label, @chapter_index, @chapter_total,
          NULL, '', NULL, '[]', @opened_at, @created_at, @updated_at)
      `).run({
        key: item.key, series_id: item.seriesId, url: item.url, title: item.title,
        cover_url: item.coverUrl, source: item.source, category: item.category,
        current_page: item.currentPage, total_pages: item.totalPages,
        chapter_label: item.chapterLabel, chapter_index: item.chapterIndex, chapter_total: item.chapterTotal,
        opened_at: item.openedAt ?? now, created_at: item.createdAt ?? now, updated_at: now
      })
    }
    return this.get(item.key)!
  }

  updateProgress(key: string, currentPage: number, totalPages: number, openedAt: number): void {
    this.db.prepare(`
      UPDATE series SET current_page = ?, total_pages = MAX(total_pages, ?), opened_at = ?, updated_at = ?
      WHERE key = ?
    `).run(currentPage, totalPages, openedAt, Date.now(), key)
  }

  private patch(key: string, col: string, value: unknown): void {
    this.db.prepare(`UPDATE series SET ${col} = ?, updated_at = ? WHERE key = ?`).run(value, Date.now(), key)
  }

  setStatus(key: string, status: ReadingStatus | null): void { this.patch(key, 'status', status) }
  setNote(key: string, note: string): void { this.patch(key, 'note', note) }
  setRating(key: string, rating: number | null): void { this.patch(key, 'rating', rating) }
  setTags(key: string, tags: string[]): void { this.patch(key, 'tags', JSON.stringify(tags)) }

  delete(key: string): void { this.db.prepare('DELETE FROM series WHERE key = ?').run(key) }
  clearHistory(): void { this.db.prepare('DELETE FROM series WHERE status IS NULL').run() }

  importItems(items: LibraryItem[]): { added: number; updated: number } {
    let added = 0
    let updated = 0
    const tx = this.db.transaction((rows: LibraryItem[]) => {
      for (const i of rows) {
        const cur = this.get(i.key)
        if (!cur) {
          this.db.prepare(`
            INSERT INTO series (key, series_id, url, title, cover_url, source, category,
              current_page, total_pages, chapter_label, chapter_index, chapter_total,
              status, note, rating, tags, opened_at, created_at, updated_at)
            VALUES (@key, @series_id, @url, @title, @cover_url, @source, @category,
              @current_page, @total_pages, @chapter_label, @chapter_index, @chapter_total,
              @status, @note, @rating, @tags, @opened_at, @created_at, @updated_at)
          `).run({
            key: i.key, series_id: i.seriesId, url: i.url, title: i.title, cover_url: i.coverUrl,
            source: i.source, category: i.category, current_page: i.currentPage, total_pages: i.totalPages,
            chapter_label: i.chapterLabel, chapter_index: i.chapterIndex, chapter_total: i.chapterTotal,
            status: i.status, note: i.note, rating: i.rating, tags: JSON.stringify(i.tags),
            opened_at: i.openedAt, created_at: i.createdAt, updated_at: i.updatedAt
          })
          added++
        } else if (i.updatedAt > cur.updatedAt) {
          this.db.prepare(`
            UPDATE series SET series_id=@series_id, url=@url, title=@title, cover_url=@cover_url,
              source=@source, category=@category, current_page=@current_page, total_pages=@total_pages,
              chapter_label=@chapter_label, chapter_index=@chapter_index, chapter_total=@chapter_total,
              status=@status, note=@note, rating=@rating, tags=@tags,
              opened_at=@opened_at, created_at=@created_at, updated_at=@updated_at
            WHERE key=@key
          `).run({
            key: i.key, series_id: i.seriesId, url: i.url, title: i.title, cover_url: i.coverUrl,
            source: i.source, category: i.category, current_page: i.currentPage, total_pages: i.totalPages,
            chapter_label: i.chapterLabel, chapter_index: i.chapterIndex, chapter_total: i.chapterTotal,
            status: i.status, note: i.note, rating: i.rating, tags: JSON.stringify(i.tags),
            opened_at: i.openedAt, created_at: i.createdAt, updated_at: i.updatedAt
          })
          updated++
        }
      }
    })
    tx(items)
    return { added, updated }
  }
}
```

- [ ] **Step 3: Создать `src/main/services/db.ts`**

```ts
import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, renameSync } from 'fs'
import { SqliteSeriesRepository } from './sqlite-series-repository'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS series (
  key TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  cover_url TEXT,
  source TEXT,
  category TEXT NOT NULL DEFAULT 'main',
  current_page INTEGER NOT NULL DEFAULT 1,
  total_pages INTEGER NOT NULL DEFAULT 0,
  chapter_label TEXT,
  chapter_index INTEGER,
  chapter_total INTEGER,
  status TEXT,
  note TEXT NOT NULL DEFAULT '',
  rating INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  opened_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_series_status ON series(status);
CREATE INDEX IF NOT EXISTS idx_series_opened ON series(opened_at);
CREATE INDEX IF NOT EXISTS idx_series_title ON series(title);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`

export interface DbHandle {
  db: Database.Database
  repo: SqliteSeriesRepository
}

export function openDatabase(userDataDir: string): DbHandle {
  const path = join(userDataDir, 'library.db')
  let db: Database.Database
  try {
    db = new Database(path)
  } catch {
    if (existsSync(path)) renameSync(path, `${path}.corrupt-${Date.now()}`)
    db = new Database(path)
  }
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)
  return { db, repo: new SqliteSeriesRepository(db) }
}
```

- [ ] **Step 4: Прогнать typecheck и тесты (нативный модуль в vitest не грузится)**

Run: `npm run typecheck && npm test`
Expected: PASS. Если `npm install` пересобрал `better-sqlite3` под Electron — тесты всё равно зелёные, т.к. `better-sqlite3` не импортируется из тестов.

- [ ] **Step 5: Dev-smoke (вручную)**

Запустить `npm run dev`, открыть каталог, открыть галерею, закрыть приложение. Проверить, что в `%APPDATA%/manga-reader-electron/library.db` (или соответствующий userData) появился файл и в нём есть строка (`sqlite3` или DB Browser). Ошибок `better-sqlite3` в консоли быть не должно.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json electron-builder.yml src/main/services/db.ts src/main/services/series-repository.ts
git commit -m "feat(library): sqlite storage (better-sqlite3) with schema and repo"
```

---

### Task 6: `LibraryService`

**Files:**
- Create: `src/main/services/library.ts`
- Test: `tests/library-service.test.ts`

**Interfaces:**
- Consumes: `SeriesRepository` (Task 3), `seriesKeyForUrl` (Task 1), `LibraryItem`/`SeriesUpsert`/`ReadingStatus`/`LibraryQuery` (Task 2).
- Produces: `LibraryService`:
  - `constructor(repo: SeriesRepository, opts: { autoAdd: () => boolean })`
  - `autoAddIfNeeded(url: string, seriesId: string): void`
  - `addFromCatalog(entry: { url: string; title: string; coverUrl: string | null; source: string; seriesId: string; category?: string }): LibraryItem`
  - `get(key)`, `list(query)`, `countByStatus()`
  - `setStatus(key, status|null)`, `setNote`, `setRating`, `setTags`
  - `removeFromLibrary(key)`, `deleteSeries(key)`

- [ ] **Step 1: Написать тест**

`tests/library-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { LibraryService } from '../src/main/services/library'
import { InMemorySeriesRepository } from '../src/main/services/series-repository'

function make(autoAdd = true): { svc: LibraryService; repo: InMemorySeriesRepository } {
  const repo = new InMemorySeriesRepository()
  return { svc: new LibraryService(repo, { autoAdd: () => autoAdd }), repo }
}

const seed = (repo: InMemorySeriesRepository, key = 'nh:1', url = 'https://nhentai.net/g/1/'): void => {
  repo.upsertHistory({
    key, seriesId: key, url, title: 'A', coverUrl: null, source: 'NHentai', category: 'r34',
    currentPage: 1, totalPages: 10, chapterLabel: null, chapterIndex: null, chapterTotal: null
  })
}

describe('LibraryService', () => {
  it('auto-adds online rows as reading', () => {
    const { svc, repo } = make(true)
    seed(repo)
    svc.autoAddIfNeeded('https://nhentai.net/g/1/', 'nh:1')
    expect(repo.get('nh:1')!.status).toBe('reading')
  })

  it('does not auto-add local files', () => {
    const { svc, repo } = make(true)
    repo.upsertHistory({ key: 'local:file://c:/x', seriesId: 'local:file://c:/x', url: 'file://C:/x', title: 'L', coverUrl: null, source: 'Локальная папка', category: 'main', currentPage: 1, totalPages: 3, chapterLabel: null, chapterIndex: null, chapterTotal: null })
    svc.autoAddIfNeeded('file://C:/x', 'local:file://c:/x')
    expect(repo.get('local:file://c:/x')!.status).toBeNull()
  })

  it('does not auto-add when disabled or already in library', () => {
    const off = make(false)
    seed(off.repo)
    off.svc.autoAddIfNeeded('https://nhentai.net/g/1/', 'nh:1')
    expect(off.repo.get('nh:1')!.status).toBeNull()

    const on = make(true)
    seed(on.repo)
    on.repo.setStatus('nh:1', 'completed')
    on.svc.autoAddIfNeeded('https://nhentai.net/g/1/', 'nh:1')
    expect(on.repo.get('nh:1')!.status).toBe('completed')
  })

  it('addFromCatalog inserts as planned', () => {
    const { svc, repo } = make()
    const it = svc.addFromCatalog({ url: 'https://manga-shi.org/manga/foo/tom-1/glava-1/', title: 'Foo', coverUrl: 'c', source: 'Manga-shi', seriesId: 'https://manga-shi.org/manga/foo/' })
    expect(it.status).toBe('planned')
    expect(repo.get('ms:foo')).not.toBeNull()
  })

  it('sets fields and removes from library', () => {
    const { svc, repo } = make()
    seed(repo)
    svc.setStatus('nh:1', 'reading')
    svc.setNote('nh:1', 'note')
    svc.setRating('nh:1', 8)
    svc.setTags('nh:1', ['a', 'b'])
    const it = repo.get('nh:1')!
    expect([it.status, it.note, it.rating, it.tags]).toEqual(['reading', 'note', 8, ['a', 'b']])
    svc.removeFromLibrary('nh:1')
    expect(repo.get('nh:1')!.status).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx vitest run tests/library-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Создать `src/main/services/library.ts`**

```ts
import type { LibraryItem, SeriesUpsert, ReadingStatus, LibraryQuery } from '@shared/library'
import type { SeriesRepository } from './series-repository'
import { seriesKeyForUrl } from './series-key'

export interface CatalogAddEntry {
  url: string
  title: string
  coverUrl: string | null
  source: string
  seriesId: string
  category?: string
}

export class LibraryService {
  constructor(
    private repo: SeriesRepository,
    private opts: { autoAdd: () => boolean }
  ) {}

  autoAddIfNeeded(url: string, seriesId: string): void {
    if (!this.opts.autoAdd() || url.startsWith('file:')) return
    const key = seriesKeyForUrl(url) ?? seriesId ?? url
    const item = this.repo.get(key) ?? this.repo.findByUrl(url)
    if (item && item.status === null) this.repo.setStatus(item.key, 'reading')
  }

  addFromCatalog(entry: CatalogAddEntry): LibraryItem {
    const key = seriesKeyForUrl(entry.url) ?? entry.seriesId ?? entry.url
    const upsert: SeriesUpsert = {
      key, seriesId: entry.seriesId, url: entry.url, title: entry.title,
      coverUrl: entry.coverUrl, source: entry.source, category: entry.category ?? 'main',
      currentPage: 1, totalPages: 0, chapterLabel: null, chapterIndex: null, chapterTotal: null
    }
    const item = this.repo.upsertHistory(upsert)
    this.repo.setStatus(item.key, 'planned')
    return this.repo.get(item.key)!
  }

  get(key: string): LibraryItem | null { return this.repo.get(key) }
  list(query: LibraryQuery): LibraryItem[] { return this.repo.list(query) }
  countByStatus(): Record<string, number> { return this.repo.countByStatus() }
  setStatus(key: string, status: ReadingStatus | null): void { this.repo.setStatus(key, status) }
  setNote(key: string, note: string): void { this.repo.setNote(key, note) }
  setRating(key: string, rating: number | null): void { this.repo.setRating(key, rating) }
  setTags(key: string, tags: string[]): void { this.repo.setTags(key, tags) }
  removeFromLibrary(key: string): void { this.repo.setStatus(key, null) }
  deleteSeries(key: string): void { this.repo.delete(key) }
}
```

- [ ] **Step 4: Запустить — должен пройти**

Run: `npx vitest run tests/library-service.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/library.ts tests/library-service.test.ts
git commit -m "feat(library): LibraryService (auto-add, catalog add, statuses, tags)"
```

---

### Task 7: IPC + preload + проводка в main

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Test: `tests/ipc-library.test.ts` (проверка формы каналов)

**Interfaces:**
- Consumes: `LibraryService` (Task 6), `openDatabase` (Task 5), `LibraryItem`/`LibraryQuery`/`ReadingStatus` (Task 2).
- Produces: IPC-каналы `library:list/get/add/setStatus/setNote/setRating/setTags/remove/delete/counts` + событие `library:changed`; методы `window.api.library*` и `onLibraryChanged`.

- [ ] **Step 1: Написать тест на каналы**

`tests/ipc-library.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CH } from '../src/shared/ipc'

describe('library IPC channels', () => {
  it('exposes all library channels', () => {
    expect(CH.libraryList).toBe('library:list')
    expect(CH.libraryGet).toBe('library:get')
    expect(CH.libraryAdd).toBe('library:add')
    expect(CH.librarySetStatus).toBe('library:setStatus')
    expect(CH.librarySetNote).toBe('library:setNote')
    expect(CH.librarySetRating).toBe('library:setRating')
    expect(CH.librarySetTags).toBe('library:setTags')
    expect(CH.libraryRemove).toBe('library:remove')
    expect(CH.libraryDelete).toBe('library:delete')
    expect(CH.libraryCounts).toBe('library:counts')
    expect(CH.libraryChanged).toBe('library:changed')
  })
})
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx vitest run tests/ipc-library.test.ts`
Expected: FAIL — свойства не найдены.

- [ ] **Step 3: Расширить `src/shared/ipc.ts`**

Добавить импорты типов:

```ts
import type { LibraryItem, LibraryQuery, ReadingStatus } from './library'
```

> `ExAccount` и `DownloadTask` уже доступны в этом файле — импортировать не нужно.

Добавить интерфейсы:

```ts
export interface BackupFile {
  format: 'manga-reader-backup'
  version: number
  exportedAt: number
  settings: Settings
  series: LibraryItem[]
  accounts?: ExAccount[]
  downloads: DownloadTask[]
}

export interface BackupSummary {
  seriesAdded: number
  seriesUpdated: number
  accountsAdded: number
  downloadsMerged: number
}
```

В `Api` добавить:

```ts
  libraryList(query: LibraryQuery): Promise<LibraryItem[]>
  libraryGet(key: string): Promise<LibraryItem | null>
  libraryAdd(entry: { url: string; title: string; coverUrl: string | null; source: string; seriesId: string; category?: string }): Promise<LibraryItem>
  librarySetStatus(key: string, status: ReadingStatus | null): Promise<void>
  librarySetNote(key: string, note: string): Promise<void>
  librarySetRating(key: string, rating: number | null): Promise<void>
  librarySetTags(key: string, tags: string[]): Promise<void>
  libraryRemove(key: string): Promise<void>
  libraryDelete(key: string): Promise<void>
  libraryCounts(): Promise<Record<string, number>>
  backupExport(includeSecrets: boolean): Promise<{ canceled: boolean; path?: string }>
  backupImport(): Promise<BackupSummary | null>
  onLibraryChanged(cb: () => void): () => void
```

В `CH` добавить:

```ts
  libraryList: 'library:list',
  libraryGet: 'library:get',
  libraryAdd: 'library:add',
  librarySetStatus: 'library:setStatus',
  librarySetNote: 'library:setNote',
  librarySetRating: 'library:setRating',
  librarySetTags: 'library:setTags',
  libraryRemove: 'library:remove',
  libraryDelete: 'library:delete',
  libraryCounts: 'library:counts',
  libraryChanged: 'library:changed',
  backupExport: 'backup:export',
  backupImport: 'backup:import',
```

- [ ] **Step 4: Расширить `src/preload/index.ts`**

```ts
  libraryList: (query) => ipcRenderer.invoke(CH.libraryList, query),
  libraryGet: (key) => ipcRenderer.invoke(CH.libraryGet, key),
  libraryAdd: (entry) => ipcRenderer.invoke(CH.libraryAdd, entry),
  librarySetStatus: (key, status) => ipcRenderer.invoke(CH.librarySetStatus, key, status),
  librarySetNote: (key, note) => ipcRenderer.invoke(CH.librarySetNote, key, note),
  librarySetRating: (key, rating) => ipcRenderer.invoke(CH.librarySetRating, key, rating),
  librarySetTags: (key, tags) => ipcRenderer.invoke(CH.librarySetTags, key, tags),
  libraryRemove: (key) => ipcRenderer.invoke(CH.libraryRemove, key),
  libraryDelete: (key) => ipcRenderer.invoke(CH.libraryDelete, key),
  libraryCounts: () => ipcRenderer.invoke(CH.libraryCounts),
  backupExport: (includeSecrets) => ipcRenderer.invoke(CH.backupExport, includeSecrets),
  backupImport: () => ipcRenderer.invoke(CH.backupImport),
  onLibraryChanged: (cb) => {
    const fn = (): void => cb()
    ipcRenderer.on(CH.libraryChanged, fn)
    return () => ipcRenderer.removeListener(CH.libraryChanged, fn)
  },
```

- [ ] **Step 5: Проводка в `src/main/index.ts`**

Добавить импорты:

```ts
import { openDatabase } from './services/db'
import { LibraryService } from './services/library'
```

Объявить переменные рядом с другими:

```ts
let library: LibraryService
```

После `history = new HistoryManager(...)` заменить создание history на репозиторий. Т.к. `openDatabase` нужен до history, поменять блок (строки ~257):

```ts
  const { repo } = openDatabase(app.getPath('userData'))
  history = new HistoryManager(repo)
  history.load(settings.get().viewing_history)
  library = new LibraryService(repo, { autoAdd: () => settings.get().library_auto_add })
```

Добавить broadcast-хелпер и хендлеры (после `ipcMain.handle(CH.getHistory, ...)`):

```ts
  function broadcastLibrary(): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.libraryChanged)
  }

  ipcMain.handle(CH.libraryList, (_e, query) => library.list(query ?? {}))
  ipcMain.handle(CH.libraryGet, (_e, key: string) => library.get(String(key)))
  ipcMain.handle(CH.libraryAdd, (_e, entry) => {
    const item = library.addFromCatalog(entry)
    broadcastLibrary()
    return item
  })
  ipcMain.handle(CH.librarySetStatus, (_e, key: string, status: any) => { library.setStatus(String(key), status); broadcastLibrary() })
  ipcMain.handle(CH.librarySetNote, (_e, key: string, note: string) => { library.setNote(String(key), String(note ?? '')); broadcastLibrary() })
  ipcMain.handle(CH.librarySetRating, (_e, key: string, rating: number | null) => { library.setRating(String(key), rating); broadcastLibrary() })
  ipcMain.handle(CH.librarySetTags, (_e, key: string, tags: string[]) => { library.setTags(String(key), Array.isArray(tags) ? tags : []); broadcastLibrary() })
  ipcMain.handle(CH.libraryRemove, (_e, key: string) => { library.removeFromLibrary(String(key)); broadcastLibrary() })
  ipcMain.handle(CH.libraryDelete, (_e, key: string) => { library.deleteSeries(String(key)); broadcastLibrary() })
  ipcMain.handle(CH.libraryCounts, () => library.countByStatus())
```

В `openUrl` после `history.addOrUpdate(...)` и `settings.save(...)` добавить:

```ts
    library.autoAddIfNeeded(trimmed, seriesId)
```

В `openFolder` для локальной ветки — НЕ вызывать (file:// исключается внутри `autoAddIfNeeded`, можно не добавлять).

> `backupExport`/`backupImport` хендлеры появятся в Task 11; в `Api` они объявлены сейчас, но preload вызывает каналы, которые зарегистрируются позже — до Task 11 кнопок в UI нет, поэтому вызовов не будет.

- [ ] **Step 6: Прогнать тесты и typecheck**

Run: `npx vitest run tests/ipc-library.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts tests/ipc-library.test.ts
git commit -m "feat(library): IPC channels, preload API and main wiring (auto-add on open)"
```

---

### Task 8: Экран Library + сайдбар + store

**Files:**
- Modify: `src/renderer/src/state/store.tsx`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/App.tsx`
- Create: `src/renderer/src/screens/Library.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: ручной (UI)

**Interfaces:**
- Consumes: `LibraryItem`, `LibraryQuery`, `ReadingStatus`, `LibrarySort`, `READING_STATUSES` (Task 2); `window.api.library*` (Task 7).

- [ ] **Step 1: Расширить `Screen` и сайдбар**

В `store.tsx`: `export type Screen = 'Reader' | 'Catalog' | 'Library' | 'History' | 'Downloads' | 'Settings'`.

В `Sidebar.tsx` добавить в `ITEMS` после Catalog:

```ts
  { key: 'Library', icon: '\u2605', label: 'Library' },
```

и расширить union в типе `ITEMS` (добавить `'Library'`).

В `App.tsx` добавить импорт и рендер:

```tsx
import Library from './screens/Library'
// ...
{screen === 'Library' && <Library />}
```

- [ ] **Step 2: Создать `src/renderer/src/screens/Library.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { LibraryItem, LibraryQuery, LibrarySort, ReadingStatus } from '@shared/library'
import { READING_STATUSES } from '@shared/library'
import LibraryItemModal from '../components/LibraryItemModal'

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading', planned: 'Planned', completed: 'Completed',
  on_hold: 'On hold', dropped: 'Dropped'
}

const TABS: (ReadingStatus | 'all')[] = ['all', ...READING_STATUSES]

const SORTS: [LibrarySort, string][] = [
  ['last_read', 'Последнее чтение'], ['title', 'Название'], ['rating', 'Оценка'], ['added', 'Добавлено']
]

function coverSrc(url: string): string {
  return `manga://cover/${encodeURIComponent(url)}`
}

export default function Library(): JSX.Element {
  const { setScreen, setOpened, settings } = useStore()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [status, setStatus] = useState<ReadingStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<LibrarySort>('last_read')
  const [selected, setSelected] = useState<LibraryItem | null>(null)

  const refresh = useCallback(() => {
    const q: LibraryQuery = { status, search, sort, includeR34: settings.show_r34_history }
    void window.api.libraryList(q).then(setItems)
    void window.api.libraryCounts().then(setCounts)
  }, [status, search, sort, settings.show_r34_history])

  useEffect(refresh, [refresh])
  useEffect(() => window.api.onLibraryChanged(refresh), [refresh])

  const open = async (item: LibraryItem): Promise<void> => {
    const start = Math.max(0, item.currentPage - 1)
    const r = await window.api.openUrl(item.url, start, item.seriesId, item.coverUrl)
    if (r) {
      setOpened({ kind: 'online', ...r, startPage: start, coverUrl: item.coverUrl })
      setScreen('Reader')
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div className="screen library">
      <div className="library-toolbar">
        <input
          className="catalog-search"
          placeholder="Поиск по названию…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)}>
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="library-tabs">
        {TABS.map((t) => {
          const label = t === 'all' ? 'Все' : STATUS_LABELS[t]
          const n = t === 'all' ? total : (counts[t] ?? 0)
          return (
            <button
              key={t}
              className={`tab${status === t ? ' active' : ''}`}
              onClick={() => setStatus(t)}
            >{label} ({n})</button>
          )
        })}
      </div>

      {items.length === 0 && <div className="muted">В библиотеке пока пусто</div>}
      <div className="history-grid">
        {items.map((it) => (
          <div key={it.key} className="history-card" onClick={() => setSelected(it)}>
            <div className="history-cover">
              {it.coverUrl
                ? <img src={coverSrc(it.coverUrl)} alt="" loading="lazy" />
                : <div className="cover-placeholder" />}
            </div>
            <div className="history-title" title={it.title}>{it.title || 'Без названия'}</div>
            <div className="history-meta">
              <span>{it.status ? STATUS_LABELS[it.status] : ''}{it.rating != null ? ` · ★ ${it.rating}` : ''}</span>
              <button className="continue-btn" onClick={(e) => { e.stopPropagation(); void open(it) }}>▶ Открыть</button>
            </div>
            {it.note && <div className="library-note muted" title={it.note}>{it.note}</div>}
            <div className="bar-label muted">стр. {it.currentPage}/{it.totalPages}</div>
          </div>
        ))}
      </div>

      {selected && (
        <LibraryItemModal
          item={selected}
          onClose={() => setSelected(null)}
          onOpen={async () => { await open(selected); setSelected(null) }}
          onChanged={() => { setSelected(null); refresh() }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Добавить стили**

В `src/renderer/src/styles.css` добавить:

```css
.library-toolbar { display: flex; gap: 8px; margin-bottom: 8px; }
.library-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.library-note { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 4: Проверка**

Run: `npm run typecheck`
Expected: PASS (модалка `LibraryItemModal` появится в Task 9 — на этом шаге typecheck упадёт из-за отсутствующего импорта; поэтому **шаг 4 выполняется после Task 9** либо временно закомментировать импорт). Во избежание красной сборки: выполнять Task 8 и Task 9 одним заходом, коммит — после Task 9.

- [ ] **Step 5: Commit — после Task 9**

---

### Task 9: Модалка карточки + кнопки «В библиотеку»

**Files:**
- Create: `src/renderer/src/components/LibraryItemModal.tsx`
- Modify: `src/renderer/src/screens/Catalog.tsx`, `src/renderer/src/screens/Reader.tsx`, `src/renderer/src/components/HistoryCardGrid.tsx`, `src/renderer/src/screens/History.tsx`, `src/renderer/src/screens/Settings.tsx`, `src/renderer/src/styles.css`
- Test: ручной (UI)

**Interfaces:**
- Consumes: `LibraryItem`, `READING_STATUSES`, `ReadingStatus` (Task 2); `window.api.library*` (Task 7).

- [ ] **Step 1: Создать `LibraryItemModal.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { LibraryItem, ReadingStatus } from '@shared/library'
import { READING_STATUSES } from '@shared/library'

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading', planned: 'Planned', completed: 'Completed',
  on_hold: 'On hold', dropped: 'Dropped'
}

interface Props {
  item: LibraryItem
  onClose: () => void
  onOpen: () => void
  onChanged: () => void
}

export default function LibraryItemModal({ item, onClose, onOpen, onChanged }: Props): JSX.Element {
  const [status, setStatus] = useState<ReadingStatus | ''>(item.status ?? '')
  const [rating, setRating] = useState(item.rating ?? 0)
  const [note, setNote] = useState(item.note)
  const [tags, setTags] = useState(item.tags.join(', '))

  useEffect(() => {
    setStatus(item.status ?? ''); setRating(item.rating ?? 0); setNote(item.note); setTags(item.tags.join(', '))
  }, [item.key])

  const save = async (): Promise<void> => {
    await window.api.librarySetStatus(item.key, status === '' ? null : status)
    await window.api.librarySetRating(item.key, rating > 0 ? rating : null)
    await window.api.librarySetNote(item.key, note)
    await window.api.librarySetTags(item.key, tags.split(',').map((t) => t.trim()).filter(Boolean))
    onChanged()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card chapters" onClick={(e) => e.stopPropagation()}>
        <h3>{item.title || 'Без названия'}</h3>
        <div className="row">
          <label>Статус:</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as ReadingStatus | '')}>
            <option value="">— не в библиотеке —</option>
            {READING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="row">
          <label>Оценка: {rating > 0 ? rating : '—'}</label>
          <input type="range" min={0} max={10} step={1} value={rating} onChange={(e) => setRating(Number(e.target.value))} />
        </div>
        <div className="row">
          <label>Заметка:</label>
        </div>
        <textarea className="cookie-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="row">
          <label>Теги (через запятую):</label>
        </div>
        <input className="text-input" value={tags} onChange={(e) => setTags(e.target.value)} />
        <div className="row">
          <button onClick={onOpen}>▶ Открыть</button>
          <button onClick={() => void save()}>Сохранить</button>
          <button onClick={async () => { await window.api.libraryRemove(item.key); onChanged() }}>Убрать из библиотеки</button>
          <button onClick={async () => {
            if (!window.confirm('Удалить запись из истории и библиотеки?')) return
            await window.api.libraryDelete(item.key); onChanged()
          }}>Удалить из истории</button>
          <button onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Кнопка в каталоге (`Catalog.tsx`)**

В overlay `picked` (после `<h3>{picked.title}</h3>`) добавить:

```tsx
            <button onClick={() => void (async () => {
              await window.api.libraryAdd({
                url: picked.url,
                title: picked.title,
                coverUrl: picked.coverUrl,
                source: SOURCES.find((s) => s.key === source)?.label ?? '',
                seriesId: picked.url
              })
              setExNotice('Добавлено в библиотеку')
            })()}>＋ В библиотеку</button>
```

- [ ] **Step 3: Кнопка в ридере (`Reader.tsx`)**

В тулбаре после кнопки `Главы` добавить:

```tsx
        {opened?.kind === 'online' && (
          <button onClick={() => void (async () => {
            await window.api.libraryAdd({
              url: opened.url,
              title: opened.title,
              coverUrl: opened.coverUrl ?? null,
              source: opened.source,
              seriesId: opened.mangaId ?? opened.url
            })
          })()}>＋ Library</button>
        )}
```

- [ ] **Step 4: Кнопка в истории (`HistoryCardGrid.tsx` + `History.tsx`)**

В `HistoryCardGrid.tsx` добавить prop `onAddToLibrary?: (e: HistoryEntry) => void` и кнопку в `.history-meta`:

```tsx
              {onAddToLibrary && (
                <button className="continue-btn" onClick={(ev) => { ev.stopPropagation(); onAddToLibrary(e) }}>＋</button>
              )}
```

В `History.tsx` передать обработчик:

```tsx
      <HistoryCardGrid
        entries={visible}
        onContinue={onContinue}
        onAddToLibrary={(e) => void window.api.libraryAdd({
          url: e.url, title: e.title, coverUrl: e.cover_url, source: e.source, seriesId: e.series_id
        })}
      />
```

- [ ] **Step 5: Тумблер авто-добавления в `Settings.tsx`**

В секцию «Каталог» (или новую «Библиотека») добавить:

```tsx
        <Section title="Библиотека">
          <div className="row">
            <Toggle checked={settings.library_auto_add} onChange={(v) => upd({ library_auto_add: v })}>
              Авто-добавлять открытые галереи в библиотеку
            </Toggle>
          </div>
        </Section>
```

- [ ] **Step 6: Проверка + коммит (вместе с Task 8)**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/renderer/src/screens/Library.tsx src/renderer/src/components/LibraryItemModal.tsx \
  src/renderer/src/screens/Catalog.tsx src/renderer/src/screens/Reader.tsx \
  src/renderer/src/components/HistoryCardGrid.tsx src/renderer/src/screens/History.tsx \
  src/renderer/src/screens/Settings.tsx src/renderer/src/components/Sidebar.tsx \
  src/renderer/src/state/store.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat(library): Library screen, item modal, add-to-library buttons"
```

---

### Task 10: `backup.ts` — сборка/разбор/слияние

**Files:**
- Create: `src/main/services/backup.ts`
- Test: `tests/backup.test.ts`

**Interfaces:**
- Consumes: `BackupFile`/`BackupSummary` (Task 7), `LibraryItem` (Task 2), `Settings` (`@shared/settings`), `ExAccount`/`DownloadTask`.
- Produces: `BACKUP_FORMAT`, `BACKUP_VERSION`, `sanitizeSettings(s, includeSecrets)`, `buildBackup(...)`, `parseBackup(text)`.

- [ ] **Step 1: Написать тест**

`tests/backup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeSettings, parseBackup, BACKUP_FORMAT, BACKUP_VERSION } from '../src/main/services/backup'
import { defaultSettings } from '../src/shared/settings'
import type { LibraryItem } from '../src/shared/library'

const item = (over: Partial<LibraryItem> = {}): LibraryItem => ({
  key: 'nh:1', seriesId: 'nh:1', url: 'https://nhentai.net/g/1/', title: 'A', coverUrl: null,
  source: 'NHentai', category: 'r34', currentPage: 1, totalPages: 10, chapterLabel: null,
  chapterIndex: null, chapterTotal: null, status: 'reading', note: '', rating: null, tags: [],
  openedAt: 1, createdAt: 1, updatedAt: 1, ...over
})

describe('sanitizeSettings', () => {
  it('strips secrets by default and keeps them with includeSecrets', () => {
    const s = { ...defaultSettings(), onion_cookies_raw: 'SECRET', exhentai_proxy_addr: '1.2.3.4:9', tor_bridges: 'obfs4 x' }
    const clean = sanitizeSettings(s, false)
    expect(clean.onion_cookies_raw).toBe('')
    expect(clean.exhentai_proxy_addr).toBe('')
    expect(clean.tor_bridges).toBe('')
    const full = sanitizeSettings(s, true)
    expect(full.onion_cookies_raw).toBe('SECRET')
    expect(full.exhentai_proxy_addr).toBe('1.2.3.4:9')
  })
})

describe('parseBackup', () => {
  it('rejects wrong format/version', () => {
    expect(() => parseBackup('{}')).toThrow()
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 999 }))).toThrow()
  })
  it('accepts a valid envelope', () => {
    const text = JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: 1, settings: defaultSettings(), series: [item()], downloads: [] })
    expect(parseBackup(text).series).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx vitest run tests/backup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Создать `src/main/services/backup.ts`**

```ts
import type { Settings } from '@shared/settings'
import type { LibraryItem } from '@shared/library'
import type { BackupFile, BackupSummary, ExAccount } from '@shared/ipc'
import type { DownloadTask } from '@shared/downloads'

export const BACKUP_FORMAT = 'manga-reader-backup' as const
export const BACKUP_VERSION = 1

const SECRET_SETTINGS = [
  'onion_cookies_raw', 'nhentai_cookies_raw', 'nhentai_onion_cookies_raw',
  'senkuro_cookies_raw', 'exhentai_proxy_addr', 'mangalib_proxy_addr', 'tor_bridges'
] as const

export function sanitizeSettings(s: Settings, includeSecrets: boolean): Settings {
  if (includeSecrets) return { ...s }
  const out = { ...s }
  for (const k of SECRET_SETTINGS) (out as any)[k] = ''
  return out
}

export function buildBackup(
  settings: Settings,
  series: LibraryItem[],
  accounts: ExAccount[],
  downloads: DownloadTask[],
  includeSecrets: boolean
): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings: sanitizeSettings(settings, includeSecrets),
    series,
    accounts: includeSecrets ? accounts : undefined,
    downloads
  }
}

export function parseBackup(text: string): BackupFile {
  let obj: any
  try { obj = JSON.parse(text) } catch { throw new Error('Файл не является корректным JSON') }
  if (!obj || obj.format !== BACKUP_FORMAT) throw new Error('Это не файл резервной копии Manga Reader')
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
    throw new Error(`Неподдерживаемая версия бэкапа: ${obj.version}`)
  }
  if (!Array.isArray(obj.series) || !Array.isArray(obj.downloads)) {
    throw new Error('Повреждённый бэкап: нет series/downloads')
  }
  return obj as BackupFile
}
```

- [ ] **Step 4: Запустить — должен пройти**

Run: `npx vitest run tests/backup.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/backup.ts tests/backup.test.ts
git commit -m "feat(backup): build/parse/sanitize/merge helpers with tests"
```

---

### Task 11: IPC бэкапа + секция в Settings

**Files:**
- Modify: `src/main/index.ts`, `src/main/services/accounts.ts`, `src/main/services/download-manager.ts`, `src/renderer/src/screens/Settings.tsx`, `src/renderer/src/styles.css`
- Test: ручной (UI)

**Interfaces:**
- Consumes: `buildBackup`/`parseBackup` (Task 10), `openDatabase`/repo (Task 5), `ExAccountsService`, `downloads`.
- Produces: рабочие каналы `backup:export` / `backup:import`.

- [ ] **Step 1: Хендлеры в `src/main/index.ts`**

Импорты:

```ts
import { buildBackup, parseBackup } from './services/backup'
import { readFileSync, writeFileSync } from 'fs'
```

(если `readFileSync`/`writeFileSync` уже импортированы — не дублировать.)

Рядом с другими `ipcMain.handle` добавить:

```ts
  ipcMain.handle(CH.backupExport, async (_e, includeSecrets: boolean) => {
    const r = await dialog.showSaveDialog({
      title: 'Экспорт данных',
      defaultPath: `manga-reader-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return { canceled: true }
    const data = buildBackup(
      settings.get(),
      repo.all(),
      exAccounts.accounts,
      downloads.list(),
      !!includeSecrets
    )
    writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf8')
    return { canceled: false, path: r.filePath }
  })

  ipcMain.handle(CH.backupImport, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Импорт данных',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (r.canceled || r.filePaths.length === 0) return null
    let backup
    try {
      backup = parseBackup(readFileSync(r.filePaths[0], 'utf8'))
    } catch (e: any) {
      dialog.showErrorBox('Импорт не выполнен', e?.message ?? String(e))
      return null
    }
    // safety copy of the current DB
    try { copyFileSync(join(app.getPath('userData'), 'library.db'), join(app.getPath('userData'), 'library.db.bak')) } catch { /* ignore */ }

    const res = repo.importItems(backup.series ?? [])

    // settings: apply, but never let empty secret fields wipe current ones
    const next = { ...settings.get(), ...backup.settings }
    for (const k of ['onion_cookies_raw', 'nhentai_cookies_raw', 'nhentai_onion_cookies_raw', 'senkuro_cookies_raw', 'exhentai_proxy_addr', 'mangalib_proxy_addr', 'tor_bridges'] as const) {
      if (String((backup.settings as any)[k] ?? '') === '') (next as any)[k] = (settings.get() as any)[k]
    }
    settings.save(next)
    setFrontingEnabled(!!next.enable_domain_fronting)
    setLibMirror(next.lib_image_server ?? null)
    setCustomDnsServers(parseDnsServerList(next.custom_dns ?? ''))

    const accountsAdded = Array.isArray(backup.accounts) ? exAccounts.importAccounts(backup.accounts) : 0

    let downloadsMerged = 0
    const existing = new Set(downloads.list().map((t) => t.sourceUrl))
    for (const t of backup.downloads ?? []) {
      if (existing.has(t.sourceUrl)) continue
      downloads.adopt(t)
      downloadsMerged++
    }

    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.libraryChanged)
    const summary: import('@shared/ipc').BackupSummary = {
      seriesAdded: res.added, seriesUpdated: res.updated, accountsAdded, downloadsMerged
    }
    return summary
  })
```

Импорт `copyFileSync` из `fs` (добавить в существующий импорт `fs`).

> Требуется метод `DownloadManager.adopt(task: DownloadTask): void` — добавить в `src/main/services/download-manager.ts`:
>
> ```ts
> adopt(task: DownloadTask): void {
>   if (this.tasks.some((t) => t.sourceUrl === task.sourceUrl)) return
>   this.tasks.push({ ...task, state: task.state === 'running' ? 'queued' : task.state })
>   this.notify()
>   void this.pump()
> }
> ```
>
> (`notify`/`pump`/`tasks` — приватные, метод добавляется внутрь класса.)

> Требуется метод `ExAccountsService.importAccounts(accounts: ExAccount[]): number` — добавить в `src/main/services/accounts.ts`:
>
> ```ts
> importAccounts(accounts: ExAccount[]): number {
>   const have = new Set(this.accounts.flatMap((a) => a.cookies.filter(([n]) => n === 'ipb_member_id').map(([, v]) => v)))
>   let added = 0
>   for (const a of accounts) {
>     const mid = a.cookies.find(([n]) => n === 'ipb_member_id')?.[1]
>     if (mid && have.has(mid)) continue
>     const id = this.accounts.reduce((m, x) => Math.max(m, x.id), 0) + 1
>     const acc: ExAccount = { ...a, id }
>     this.accounts.push(acc)
>     this.manualAccounts.push(acc)
>     if (mid) have.add(mid)
>     added++
>   }
>   if (added > 0) saveManualAccounts(this.userDataDir, this.manualAccounts)
>   return added
> }
> ```

- [ ] **Step 2: Секция в `Settings.tsx`**

Добавить состояние и разметку:

```tsx
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
```

```tsx
        <Section title="Резервная копия">
          <div className="row">
            <Toggle checked={includeSecrets} onChange={setIncludeSecrets}>
              Включить секреты (куки, прокси, аккаунты)
            </Toggle>
          </div>
          <div className="row">
            <button onClick={async () => {
              const r = await window.api.backupExport(includeSecrets)
              setBackupMsg(r.canceled ? 'Экспорт отменён' : `Сохранено: ${r.path}`)
            }}>Экспорт</button>
            <button onClick={async () => {
              const s = await window.api.backupImport()
              setBackupMsg(s
                ? `Импорт: +${s.seriesAdded} серий, ${s.seriesUpdated} обновлено, аккаунтов +${s.accountsAdded}`
                : 'Импорт отменён или не удался')
            }}>Импорт</button>
          </div>
          {backupMsg && <div className="row muted">{backupMsg}</div>}
        </Section>
```

- [ ] **Step 3: Проверка**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Dev-smoke (вручную)**

`npm run dev` → Settings → «Экспорт» (без секретов) → файл создан и в нём пустые секретные поля; «Импорт» того же файла → сообщение с нулями/обновлениями; приложение работает.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/main/services/download-manager.ts src/renderer/src/screens/Settings.tsx
git commit -m "feat(backup): export/import IPC and Settings UI (secrets opt-in)"
```

---

### Task 12: Финальная проверка

**Files:** —

- [ ] **Step 1: Полный прогон**

Run: `npm run typecheck && npm test`
Expected: PASS без пропусков.

- [ ] **Step 2: Dev-smoke (вручную)**

- `npm run dev` → открыть галерею из каталога → она появилась в Library со статусом Reading (при включённом авто-добавлении).
- Library: табы/поиск/сортировка; модалка меняет статус/оценку/заметку/теги; «Убрать из библиотеки» оставляет запись в History; «Удалить из истории» удаляет.
- History: «Очистить историю» не удаляет записи библиотеки.
- Перезапуск приложения: данные на месте (SQLite).
- Settings → Экспорт/Импорт.

- [ ] **Step 3: Commit (если остались правки)**

```bash
git status --short
git add -A
git commit -m "chore: manual smoke fixes for library/backup/sqlite"
```

---

## Self-Review

**Покрытие спеки:**
- Х-1 (SQLite, единая таблица, миграция через `HistoryManager.load` при пустом репо, устойчивость) → Tasks 1, 3, 4, 5.
- Х-2 (LibraryService: autoAdd, статусы/заметка/оценка/теги, list, remove/delete) → Task 6.
- Х-3 (экран Library, модалка, кнопки, тумблер, R34) → Tasks 8, 9.
- Х-4 (buildBackup/applyBackup, без секретов, merge, `.bak`) → Tasks 10, 11.
- IPC/типы, сборка (postinstall, asarUnpack), тесты → Tasks 5, 7, 10.

**Типы:** `LibraryItem`/`SeriesUpsert`/`SeriesRepository`/`BackupFile`/`BackupSummary` согласованы между Tasks 2–11. `ReadingStatus` — единый.

**Открытые зависимости, добавленные по ходу:**
- `DownloadManager.adopt(task)` — объявлен в Task 11.
- `SqliteSeriesRepository.importItems` — в Task 5; в Task 11 используется.
- `repo` доступен в замыкании `app.whenReady` — объявлен через `const { repo } = openDatabase(...)` (Task 7).

**Плейсхолдеров нет.** Все шаги содержат код или точную команду.
