# Избранное + контекстное меню статусов — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить отдельный раздел «Избранное» (простой список, независимый от статусов) и кастомное контекстное меню по правому клику на карточке каталога (в избранное + выбор статуса чтения).

**Architecture:** `series` получает `favorited_at` (миграция `user_version` 2→3). `SeriesRepository` — `setFavorite` + `LibraryQuery.scope`. `LibraryService` — `addFavorite`/`setFavorite`/`lookup`/`setStatusFor`. Renderer: компонент `ContextMenu` + экран `Favorites`. IPC расширяется url-based методами (renderer не считает ключи).

**Tech Stack:** TypeScript, Electron 33, React 18, better-sqlite3, vitest. Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-05-favorites-status-menu-design.md`

## Global Constraints

- Renderer — только через `window.api.*`; сеть/файлы/БД — в main.
- `better-sqlite3` импортируется только `db.ts` и `sqlite-series-repository.ts`.
- «Избранное» и статусы независимы; статусы: `reading|planned|completed|on_hold|dropped`, подписи русские (Читаю/В планах/Прочитано/Отложено/Брошено).
- Миграция `favorited_at` идемпотентна (`user_version` 2→3).
- `npm run typecheck && npm test` проходят после каждого таска.
- Рабочее дерево содержит чужой WIP: частичный стейджинг только своих hunks (как в прошлых планах).

---

### Task 1: `favoritedAt` в хранилище + миграция v3

**Files:**
- Modify: `src/shared/library.ts`
- Modify: `src/main/services/series-repository.ts`
- Modify: `src/main/services/sqlite-series-repository.ts`
- Modify: `src/main/services/db.ts`, `src/main/services/db-migrate.ts`
- Modify: `tests/db-migrate.test.ts`, `tests/backup.test.ts`, `tests/sync-payload.test.ts`, `tests/sync-service.test.ts` (во все литералы `LibraryItem` добавить `favoritedAt: null`)
- Test: `tests/series-favorites.test.ts`

**Interfaces:**
- Produces: `LibraryItem.favoritedAt: number | null`; `SeriesUpsert.favoritedAt?: number | null`; `LibraryQuery.scope?: 'library' | 'favorites'`; `SeriesRepository.setFavorite(key: string, at: number | null): void`; миграция v3.

- [ ] **Step 1: Write the failing test**

`tests/series-favorites.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { InMemorySeriesRepository } from '../src/main/services/series-repository'
import type { SeriesUpsert } from '../src/shared/library'

const up = (over: Partial<SeriesUpsert> = {}): SeriesUpsert => ({
  key: 'nh:1', seriesId: 'nh:1', url: 'https://nhentai.net/g/1/', title: 'A',
  coverUrl: null, source: 'NHentai', category: 'main',
  currentPage: 1, totalPages: 10, chapterLabel: null, chapterIndex: null, chapterTotal: null,
  ...over
})

describe('favorites', () => {
  it('setFavorite marks and unmarks', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up())
    r.setFavorite('nh:1', 123)
    expect(r.get('nh:1')!.favoritedAt).toBe(123)
    r.setFavorite('nh:1', null)
    expect(r.get('nh:1')!.favoritedAt).toBeNull()
  })

  it('scope=favorites lists only favorites, scope=library only statuses', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'nh:1', url: 'https://nhentai.net/g/1/' }))
    r.upsertHistory(up({ key: 'nh:2', url: 'https://nhentai.net/g/2/' }))
    r.setStatus('nh:1', 'reading')
    r.setFavorite('nh:2', Date.now())
    expect(r.list({ scope: 'favorites' }).map((i) => i.key)).toEqual(['nh:2'])
    expect(r.list({ scope: 'library' }).map((i) => i.key)).toEqual(['nh:1'])
    expect(r.list({}).map((i) => i.key)).toEqual(['nh:1']) // default = library
  })

  it('upsertHistory preserves favoritedAt on update', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up())
    r.setFavorite('nh:1', 5)
    r.upsertHistory(up({ currentPage: 3 }))
    expect(r.get('nh:1')!.favoritedAt).toBe(5)
  })
})
```

Extend `tests/db-migrate.test.ts`:

```ts
import { needsFavoritedAtColumn } from '../src/main/services/db-migrate'
// ...
describe('needsFavoritedAtColumn', () => {
  it('true at v2 without column, false when present', () => {
    expect(needsFavoritedAtColumn(2, ['key'])).toBe(true)
    expect(needsFavoritedAtColumn(2, ['key', 'favorited_at'])).toBe(false)
    expect(needsFavoritedAtColumn(3, ['key'])).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/series-favorites.test.ts tests/db-migrate.test.ts`
Expected: FAIL — `favoritedAt`/`needsFavoritedAtColumn` отсутствуют.

- [ ] **Step 3: Implement**

`src/shared/library.ts`:
- `LibraryItem` + `favoritedAt: number | null` (после `deletedAt`).
- `SeriesUpsert` + `favoritedAt?: number | null` (после `deletedAt?`).
- `LibraryQuery` + `scope?: 'library' | 'favorites'`.

`src/main/services/series-repository.ts`:
- интерфейс + `setFavorite(key: string, at: number | null): void`;
- `BaseSeriesRepository` — абстрактный `setFavorite`; `list`:

```ts
  list(query: LibraryQuery): LibraryItem[] {
    let items = this.all()
    items = query.scope === 'favorites'
      ? items.filter((i) => i.favoritedAt !== null)
      : items.filter((i) => i.status !== null)
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
```
- `InMemorySeriesRepository`: в insert `favoritedAt: null`; `setFavorite` → `this.patch(key, { favoritedAt: at })`.

`src/main/services/sqlite-series-repository.ts`:
- `SeriesRow` + `favorited_at: number | null`; `rowToItem` + `favoritedAt: r.favorited_at`;
- INSERT `upsertHistory` — добавить колонку `favorited_at` со значением `NULL`; UPDATE — не трогать `favorited_at`;
- `importItems` INSERT/UPDATE — добавить `favorited_at = @favorited_at` (`i.favoritedAt ?? null`);
- `setFavorite(key, at)`: `UPDATE series SET favorited_at = ?, updated_at = ? WHERE key = ?`.

`src/main/services/db-migrate.ts`:

```ts
export function needsFavoritedAtColumn(userVersion: number, columns: string[]): boolean {
  return userVersion < 3 && !columns.includes('favorited_at')
}
```

`src/main/services/db.ts`:
- SCHEMA `series` + `favorited_at INTEGER,`;
- `migrate`:

```ts
import { needsDeletedAtColumn, needsFavoritedAtColumn } from './db-migrate'
// ...
function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  const cols = (db.pragma('table_info(series)') as { name: string }[]).map((c) => c.name)
  if (needsDeletedAtColumn(version, cols)) db.exec('ALTER TABLE series ADD COLUMN deleted_at INTEGER')
  if (needsFavoritedAtColumn(version, cols)) db.exec('ALTER TABLE series ADD COLUMN favorited_at INTEGER')
  db.pragma('user_version = 3')
}
```

`tests/backup.test.ts` / `tests/sync-payload.test.ts` / `tests/sync-service.test.ts`: во все литералы `LibraryItem` добавить `favoritedAt: null` (иначе typecheck упадёт). Прогнать `rg -n "deletedAt:" tests` и рядом добавить `favoritedAt: null`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/series-favorites.test.ts tests/db-migrate.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Native migration smoke (Electron ABI)**

esbuild-бандл `db.ts` → Electron-ABI скрипт: создать БД (v3), `openDatabase` повторно идемпотентно, `PRAGMA user_version == 3`, колонка `favorited_at` есть. Зафиксировать вывод.

- [ ] **Step 6: Commit**

```bash
git add src/shared/library.ts src/main/services/series-repository.ts src/main/services/sqlite-series-repository.ts src/main/services/db.ts src/main/services/db-migrate.ts tests/series-favorites.test.ts tests/db-migrate.test.ts tests/backup.test.ts tests/sync-payload.test.ts tests/sync-service.test.ts
git commit -m "feat(favorites): favorited_at storage, scope query, migration v3"
```

---

### Task 2: Сервис избранного (`LibraryService`)

**Files:**
- Modify: `src/main/services/library.ts`
- Test: `tests/library-favorites.test.ts`

**Interfaces:**
- Consumes: `SeriesRepository.setFavorite` + `list({scope})` (Task 1), `seriesKeyForUrl`.
- Produces: `LibraryService.setFavorite(key, at)`, `addFavorite(entry): LibraryItem`, `lookup(url, seriesId)`, `setStatusFor(entry, status): LibraryItem`, `countFavorites()`.

- [ ] **Step 1: Write the failing test**

`tests/library-favorites.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { LibraryService } from '../src/main/services/library'
import { InMemorySeriesRepository } from '../src/main/services/series-repository'

function make() {
  const repo = new InMemorySeriesRepository()
  return { svc: new LibraryService(repo, { autoAdd: () => false }), repo }
}

describe('LibraryService favorites', () => {
  it('addFavorite upserts and marks, without status', () => {
    const { svc, repo } = make()
    const it = svc.addFavorite({ url: 'https://nhentai.net/g/5/', title: 'F', coverUrl: null, source: 'NHentai', seriesId: 'https://nhentai.net/g/5/' })
    expect(it.favoritedAt).not.toBeNull()
    expect(it.status).toBeNull()
    expect(repo.list({ scope: 'favorites' })).toHaveLength(1)
  })

  it('setFavorite toggles, lookup reflects state', () => {
    const { svc } = make()
    svc.addFavorite({ url: 'https://nhentai.net/g/5/', title: 'F', coverUrl: null, source: 'NHentai', seriesId: 'x' })
    expect(svc.lookup('https://nhentai.net/g/5/', 'x')!.favorited).toBe(true)
    svc.setFavorite('nh:5', null)
    expect(svc.lookup('https://nhentai.net/g/5/', 'x')?.favorited).toBe(false)
  })

  it('setStatusFor upserts and sets status independently of favorite', () => {
    const { svc, repo } = make()
    const it = svc.setStatusFor({ url: 'https://nhentai.net/g/5/', title: 'F', coverUrl: null, source: 'NHentai', seriesId: 'x' }, 'completed')
    expect(it.status).toBe('completed')
    expect(it.favoritedAt).toBeNull()
    expect(repo.list({ scope: 'library' }).map((i) => i.key)).toEqual(['nh:5'])
  })

  it('countFavorites', () => {
    const { svc } = make()
    svc.addFavorite({ url: 'https://nhentai.net/g/5/', title: 'F', coverUrl: null, source: 'NHentai', seriesId: 'x' })
    svc.addFavorite({ url: 'https://nhentai.net/g/6/', title: 'G', coverUrl: null, source: 'NHentai', seriesId: 'y' })
    expect(svc.countFavorites()).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/library-favorites.test.ts`
Expected: FAIL — методов нет.

- [ ] **Step 3: Implement (`src/main/services/library.ts`)**

Добавить импорт `type { ReadingStatus }` уже есть; `seriesKeyForUrl` уже импортируется.

```ts
  setFavorite(key: string, at: number | null): void { this.repo.setFavorite(key, at) }

  private upsertEntry(entry: CatalogAddEntry): LibraryItem {
    const key = seriesKeyForUrl(entry.url) ?? entry.seriesId ?? entry.url
    return this.repo.upsertHistory({
      key, seriesId: entry.seriesId, url: entry.url, title: entry.title,
      coverUrl: entry.coverUrl, source: entry.source, category: entry.category ?? 'main',
      currentPage: 1, totalPages: 0, chapterLabel: null, chapterIndex: null, chapterTotal: null
    })
  }

  addFavorite(entry: CatalogAddEntry): LibraryItem {
    const item = this.upsertEntry(entry)
    this.repo.setFavorite(item.key, Date.now())
    return this.repo.get(item.key)!
  }

  setStatusFor(entry: CatalogAddEntry, status: ReadingStatus): LibraryItem {
    const item = this.upsertEntry(entry)
    this.repo.setStatus(item.key, status)
    return this.repo.get(item.key)!
  }

  lookup(url: string, seriesId: string): { key: string; favorited: boolean; status: ReadingStatus | null } | null {
    const key = seriesKeyForUrl(url) ?? seriesId ?? url
    const item = this.repo.get(key) ?? this.repo.findByUrl(url)
    if (!item) return null
    return { key: item.key, favorited: item.favoritedAt !== null, status: item.status }
  }

  countFavorites(): number { return this.repo.list({ scope: 'favorites' }).length }
```

`addFromCatalog` можно переиспользовать `upsertEntry` (заменить его тело):
```ts
  addFromCatalog(entry: CatalogAddEntry): LibraryItem {
    const item = this.upsertEntry(entry)
    if (item.status === null) this.repo.setStatus(item.key, 'planned')
    return this.repo.get(item.key)!
  }
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/library-favorites.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/library.ts tests/library-favorites.test.ts
git commit -m "feat(favorites): LibraryService addFavorite/setFavorite/lookup/setStatusFor"
```

---

### Task 3: IPC + preload + типы

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Test: `tests/ipc-favorites.test.ts`

**Interfaces:**
- Consumes: `LibraryService` (Task 2).
- Produces: каналы `libraryLookup`, `librarySetFavorite`, `libraryAddFavorite`, `librarySetStatusFor`; `Api`-методы; `LibraryQuery.scope` (тип уже из Task 1).

- [ ] **Step 1: Write the failing test**

`tests/ipc-favorites.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CH } from '../src/shared/ipc'

describe('favorites IPC channels', () => {
  it('exposes channels', () => {
    expect(CH.libraryLookup).toBe('library:lookup')
    expect(CH.librarySetFavorite).toBe('library:setFavorite')
    expect(CH.libraryAddFavorite).toBe('library:addFavorite')
    expect(CH.librarySetStatusFor).toBe('library:setStatusFor')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ipc-favorites.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/shared/ipc.ts` — в `Api`:

```ts
  libraryLookup(url: string, seriesId: string): Promise<{ key: string; favorited: boolean; status: ReadingStatus | null } | null>
  librarySetFavorite(key: string, at: number | null): Promise<void>
  libraryAddFavorite(entry: { url: string; title: string; coverUrl: string | null; source: string; seriesId: string; category?: string }): Promise<LibraryItem>
  librarySetStatusFor(entry: { url: string; title: string; coverUrl: string | null; source: string; seriesId: string; category?: string }, status: ReadingStatus): Promise<LibraryItem>
```
(убедиться, что `LibraryItem` и `ReadingStatus` импортированы как типы.)

В `CH`:
```ts
  libraryLookup: 'library:lookup',
  librarySetFavorite: 'library:setFavorite',
  libraryAddFavorite: 'library:addFavorite',
  librarySetStatusFor: 'library:setStatusFor',
```

`src/preload/index.ts`:
```ts
  libraryLookup: (url, seriesId) => ipcRenderer.invoke(CH.libraryLookup, url, seriesId),
  librarySetFavorite: (key, at) => ipcRenderer.invoke(CH.librarySetFavorite, key, at),
  libraryAddFavorite: (entry) => ipcRenderer.invoke(CH.libraryAddFavorite, entry),
  librarySetStatusFor: (entry, status) => ipcRenderer.invoke(CH.librarySetStatusFor, entry, status),
```

`src/main/index.ts` — рядом с library-хендлерами:
```ts
  ipcMain.handle(CH.libraryLookup, (_e, url: string, seriesId: string) => library.lookup(String(url), String(seriesId)))
  ipcMain.handle(CH.librarySetFavorite, (_e, key: string, at: number | null) => { library.setFavorite(String(key), at); broadcastLibrary() })
  ipcMain.handle(CH.libraryAddFavorite, (_e, entry) => { const it = library.addFavorite(entry); broadcastLibrary(); return it })
  ipcMain.handle(CH.librarySetStatusFor, (_e, entry, status) => { const it = library.setStatusFor(entry, status); broadcastLibrary(); return it })
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/ipc-favorites.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts tests/ipc-favorites.test.ts
git commit -m "feat(favorites): IPC lookup/setFavorite/addFavorite/setStatusFor"
```

---

### Task 4: Компонент `ContextMenu` + правое меню в каталоге

**Files:**
- Create: `src/renderer/src/components/ContextMenu.tsx`
- Modify: `src/renderer/src/components/MangaCardGrid.tsx`, `src/renderer/src/screens/Catalog.tsx`, `src/renderer/src/styles.css`
- Test: ручной (UI)

**Interfaces:**
- Consumes: `window.api.libraryLookup/libraryAddFavorite/librarySetFavorite/librarySetStatusFor/libraryRemove` (Task 3).
- Produces: `ContextMenu` (компонент), `MenuItem` тип; `MangaCardGrid.onContextMenu?`.

- [ ] **Step 1: Создать `src/renderer/src/components/ContextMenu.tsx`**

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

interface Props { x: number; y: number; items: MenuItem[]; onClose: () => void }

export default function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.min(x, Math.max(0, window.innerWidth - r.width - 4)),
      top: Math.min(y, Math.max(0, window.innerHeight - r.height - 4))
    })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div className="context-menu" ref={ref} style={{ left: pos.left, top: pos.top }}>
      {items.map((it, i) => it.separator
        ? <div key={`sep-${i}`} className="context-sep" />
        : (
          <button
            key={`${it.label}-${i}`}
            className={`context-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => { onClose(); it.onClick() }}
          >
            <span className="context-check">{it.checked ? '✓' : ''}</span>{it.label}
          </button>
        ))}
    </div>
  )
}
```

- [ ] **Step 2: `MangaCardGrid.tsx` — prop `onContextMenu`**

```tsx
interface Props {
  cards: CatalogCard[]
  onSelect: (card: CatalogCard) => void
  progress?: Record<string, [number, number]>
  onContextMenu?: (e: React.MouseEvent, card: CatalogCard) => void
}
```
на карточке: `onContextMenu={onContextMenu ? (e) => onContextMenu(e, c) : undefined}`.

- [ ] **Step 3: `Catalog.tsx` — меню**

Импорты: `import ContextMenu, { type MenuItem } from '../components/ContextMenu'`, `import { READING_STATUSES } from '@shared/library'`, `import type { ReadingStatus } from '@shared/library'`.

Состояние:
```tsx
  const [menu, setMenu] = useState<{ x: number; y: number; card: CatalogCard; lookup: { key: string; favorited: boolean; status: ReadingStatus | null } | null } | null>(null)

  const openCardMenu = useCallback(async (e: React.MouseEvent, card: CatalogCard) => {
    e.preventDefault()
    const lookup = await window.api.libraryLookup(card.url, card.url)
    setMenu({ x: e.clientX, y: e.clientY, card, lookup })
  }, [])

  const entryOf = (card: CatalogCard) => ({
    url: card.url, title: card.title, coverUrl: card.coverUrl,
    source: SOURCES.find((s) => s.key === source)?.label ?? '', seriesId: card.url
  })

  const menuItems = (m: NonNullable<typeof menu>): MenuItem[] => {
    const entry = entryOf(m.card)
    const items: MenuItem[] = [
      m.lookup?.favorited
        ? { label: 'Убрать из избранного', checked: true, onClick: () => void window.api.librarySetFavorite(m.lookup!.key, null) }
        : { label: '★ В избранное', onClick: () => void window.api.libraryAddFavorite(entry) },
      { label: '', separator: true, onClick: () => {} },
      { label: 'Статус', disabled: true, onClick: () => {} }
    ]
    for (const s of READING_STATUSES) {
      items.push({
        label: STATUS_LABELS[s], checked: m.lookup?.status === s,
        onClick: () => void window.api.librarySetStatusFor(entry, s)
      })
    }
    if (m.lookup?.status) {
      items.push({ label: '', separator: true, onClick: () => {} })
      items.push({ label: 'Убрать из библиотеки', danger: true, onClick: () => void window.api.libraryRemove(m.lookup!.key) })
    }
    return items
  }
```
`STATUS_LABELS` — добавить в модуль (тот же словарь, что в Library):
```tsx
const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Читаю', planned: 'В планах', completed: 'Прочитано', on_hold: 'Отложено', dropped: 'Брошено'
}
```
Передать `onContextMenu={openCardMenu}` в `<MangaCardGrid ... />`.
Отрисовка в конце разметки:
```tsx
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />
      )}
```

- [ ] **Step 4: Стили (`styles.css`)**

```css
.context-menu { position: fixed; z-index: 1000; min-width: 190px; background: #141414; border: 1px solid var(--border); border-radius: 6px; padding: 4px; box-shadow: 0 8px 24px rgba(0,0,0,.6); }
.context-item { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; background: transparent; border: none; color: var(--text); padding: 5px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; }
.context-item:hover:not(:disabled) { background: #1e1410; color: var(--accent); }
.context-item:disabled { color: var(--dim); cursor: default; }
.context-item.danger:hover { color: #ef4444; }
.context-check { width: 12px; color: var(--accent); }
.context-sep { height: 1px; background: var(--border); margin: 4px 6px; }
```

- [ ] **Step 5: Проверка + коммит**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/renderer/src/components/ContextMenu.tsx src/renderer/src/components/MangaCardGrid.tsx src/renderer/src/screens/Catalog.tsx src/renderer/src/styles.css
git commit -m "feat(favorites): custom context menu on catalog cards"
```

---

### Task 5: Экран «Избранное» + сайдбар + store

**Files:**
- Create: `src/renderer/src/screens/Favorites.tsx`
- Modify: `src/renderer/src/state/store.tsx`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/App.tsx`
- Test: ручной (UI)

**Interfaces:**
- Consumes: `window.api.libraryList({ scope: 'favorites', includeR34 })`, `librarySetFavorite`, `librarySetStatusFor`, `libraryRemove`, `onLibraryChanged` etc.

- [ ] **Step 1: `store.tsx`**

`export type Screen = 'Reader' | 'Catalog' | 'Library' | 'Favorites' | 'History' | 'Downloads' | 'Settings'`.

- [ ] **Step 2: `Sidebar.tsx`**

Добавить после Library:
```ts
  { key: 'Favorites', icon: '\u2665', label: 'Favorites' },
```
(расширить union ключей в типе `ITEMS`).

- [ ] **Step 3: `App.tsx`**

```tsx
import Favorites from './screens/Favorites'
// ...
{screen === 'Favorites' && <Favorites />}
```

- [ ] **Step 4: `screens/Favorites.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { LibraryItem } from '@shared/library'
import ContextMenu, { type MenuItem } from '../components/ContextMenu'
import { READING_STATUSES, type ReadingStatus } from '@shared/library'

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Читаю', planned: 'В планах', completed: 'Прочитано', on_hold: 'Отложено', dropped: 'Брошено'
}
function coverSrc(url: string): string { return `manga://cover/${encodeURIComponent(url)}` }

export default function Favorites(): JSX.Element {
  const { setScreen, setOpened, settings } = useStore()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null)

  const refresh = useCallback(() => {
    void window.api.libraryList({ scope: 'favorites', search, sort: 'added', includeR34: settings.show_r34_history }).then(setItems)
  }, [search, settings.show_r34_history])
  useEffect(refresh, [refresh])
  useEffect(() => window.api.onLibraryChanged(refresh), [refresh])

  const open = async (item: LibraryItem): Promise<void> => {
    const start = Math.max(0, item.currentPage - 1)
    const r = await window.api.openUrl(item.url, start, item.seriesId, item.coverUrl)
    if (r) { setOpened({ kind: 'online', ...r, startPage: start, coverUrl: item.coverUrl }); setScreen('Reader') }
  }

  const itemsFor = (it: LibraryItem): MenuItem[] => {
    const out: MenuItem[] = [
      { label: 'Убрать из избранного', danger: true, onClick: () => void window.api.librarySetFavorite(it.key, null) },
      { label: '', separator: true, onClick: () => {} },
      { label: 'Статус', disabled: true, onClick: () => {} }
    ]
    for (const s of READING_STATUSES) {
      out.push({ label: STATUS_LABELS[s], checked: it.status === s, onClick: () => void window.api.librarySetStatusFor({ url: it.url, title: it.title, coverUrl: it.coverUrl, source: it.source, seriesId: it.seriesId }, s) })
    }
    if (it.status) {
      out.push({ label: '', separator: true, onClick: () => {} })
      out.push({ label: 'Убрать из библиотеки', danger: true, onClick: () => void window.api.libraryRemove(it.key) })
    }
    return out
  }

  return (
    <div className="screen library">
      <div className="library-toolbar">
        <input className="catalog-search" placeholder="Поиск по названию…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {items.length === 0 && <div className="muted">В избранном пока пусто (правый клик по карточке в каталоге)</div>}
      <div className="history-grid">
        {items.map((it) => (
          <div key={it.key} className="history-card"
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, item: it }) }}>
            <div className="history-cover">
              {it.coverUrl ? <img src={coverSrc(it.coverUrl)} alt="" loading="lazy" /> : <div className="cover-placeholder" />}
            </div>
            <div className="history-title" title={it.title}>{it.title || 'Без названия'}</div>
            <div className="history-meta">
              <span>{it.status ? STATUS_LABELS[it.status] : 'Избранное'}</span>
              <button className="continue-btn" onClick={(e) => { e.stopPropagation(); void open(it) }}>▶ Открыть</button>
            </div>
            <div className="bar-label muted">стр. {it.currentPage}/{it.totalPages}</div>
          </div>
        ))}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={itemsFor(menu.item)} onClose={() => setMenu(null)} />}
    </div>
  )
}
```

- [ ] **Step 5: Проверка + коммит**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/renderer/src/screens/Favorites.tsx src/renderer/src/state/store.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx
git commit -m "feat(favorites): Favorites screen + sidebar tab"
```

---

### Task 6: Финальная проверка

**Files:** —

- [ ] **Step 1: Полный прогон**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 2: Ручной smoke**

`npm run dev` → каталог → правый клик по карточке: «★ В избранное»; открыть «Избранное» (♥) → карточка там; правый клик на карточке избранного → статус «Читаю»; в Library появилась запись; «Убрать из избранного».

- [ ] **Step 3: Commit (если остались правки)**

```bash
git status --short
git add -A
git commit -m "chore: manual smoke fixes for favorites"
```

---

## Self-Review

**Покрытие спеки:** Ф-1 (данные/миграция/scope/setFavorite) → Task 1; Ф-2 (сервис) → Task 2; Ф-3 (IPC) → Task 3; Ф-4 (ContextMenu + каталог) → Task 4; экран «Избранное» + сайдбар → Task 5; синк (`favoritedAt` в payload) → автоматически, тест на перенос `favoritedAt` — в Task 2 (`addFavorite`) + существующий sync-payload merge тест покрывает `LibraryItem` целиком.

**Типы:** `favoritedAt` — в `LibraryItem`/`SeriesUpsert`; `LibraryQuery.scope`; `MenuItem`/`ContextMenu` — в Task 4; `lookup` возвращает `{key,favorited,status}`.

**Примечание по sync-payload:** `buildSyncPayload` клонирует элементы через `{...i, tags:[...]}` — `favoritedAt` переносится; `mergeSyncPayload` сравнивает по `updatedAt`. Отдельных правок не требуется.

**Известное:** добавление из каталога (в т.ч. в избранное) создаёт строку `series`, которая видна во «Истории» без прогресса (унаследовано). Плейсхолдеров нет.
