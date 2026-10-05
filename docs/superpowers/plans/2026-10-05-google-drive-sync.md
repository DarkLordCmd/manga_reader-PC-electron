# Google Drive Cross-Device Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Войти по Google (OAuth 2.0 desktop/PKCE, зашитый Client ID) и синхронизировать библиотеку/историю/прогресс и переносимые настройки между устройствами через скрытую папку Google Drive (`appDataFolder`), один JSON-файл; удаления распространяются tombstone'ами.

**Architecture:** Слой данных (`series`) получает `deleted_at` (мягкое удаление). Чистый модуль `sync-payload` собирает/сливает снапшот. `google-auth` (loopback + PKCE + `safeStorage`) выдаёт access-token; `google-drive` читает/пишет один файл в `appDataFolder`; `sync` оркестрирует pull→merge→apply→push. Renderer — через типизированный IPC.

**Tech Stack:** TypeScript, Electron 33 (`safeStorage`, `BrowserWindow`, `session`), React 18, better-sqlite3, vitest. Новых зависимостей нет (Node `http`, `crypto`, `fetch`).

**Spec:** `docs/superpowers/specs/2026-10-05-google-drive-sync-design.md`

## Global Constraints

- Вся сеть/файлы/окна — только в main-процессе; renderer — через `src/shared/ipc.ts`.
- `better-sqlite3` импортируется **только** `db.ts` и `sqlite-series-repository.ts` (тесты vitest не должны его грузить).
- OAuth Client ID (Desktop, non-sensitive scope `drive.appdata`):
  `59705917238-2tditham9qpns2gl7tecarqh77krg5bt.apps.googleusercontent.com`. **Client secret не используется** (PKCE). Файл `client_secret_*.json` в репозиторий не добавлять.
- Scope ровно `openid email https://www.googleapis.com/auth/drive.appdata`.
- В синк НЕ попадают: куки, аккаунты, прокси, DNS, Tor, пути, PIN, список загрузок.
- Refresh-token — только `safeStorage` (`userData/google-auth.bin`).
- Удаления — tombstone (`deleted_at`); слияние по `key` newest-`updatedAt`-wins; настройки — снапшот по `settingsUpdatedAt`.
- Русские пользовательские сообщения.
- После каждого таска: `npm run typecheck && npm test` проходят.
- Тесты — `tests/`, vitest, node env; `@shared` алиас.

---

### Task 1: Tombstone в хранилище (`deleted_at`)

**Files:**
- Modify: `src/shared/library.ts`
- Modify: `src/main/services/series-repository.ts`
- Modify: `src/main/services/sqlite-series-repository.ts`
- Modify: `src/main/services/db.ts`
- Modify: `tests/backup.test.ts` (добавить `deletedAt: null` в литерал `LibraryItem`)
- Test: `tests/series-repository-tombstone.test.ts`, `tests/db-migrate.test.ts`

**Interfaces:**
- Produces:
  - `LibraryItem.deletedAt: number | null`; `SeriesUpsert.deletedAt?: number | null`.
  - `SeriesRepository` + методы `allIncludingDeleted(): LibraryItem[]`, `getIncludingDeleted(key: string): LibraryItem | null`, `hardDelete(key: string): void`.
  - `SeriesRepository.delete(key)` становится **мягким** (tombstone); `clearHistory()` — tombstone для `status IS NULL`.
  - `SqliteSeriesRepository` конструктор без изменений; `openDatabase` мигрирует `user_version` 1→2.

- [ ] **Step 1: Write the failing test**

`tests/series-repository-tombstone.test.ts`:

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

describe('tombstones', () => {
  it('delete is soft: hidden from all/get, visible in allIncludingDeleted', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up())
    r.delete('nh:1')
    expect(r.all()).toHaveLength(0)
    expect(r.get('nh:1')).toBeNull()
    expect(r.allIncludingDeleted()).toHaveLength(1)
    expect(r.getIncludingDeleted('nh:1')!.deletedAt).not.toBeNull()
  })

  it('upsertHistory resurrects a tombstoned row', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up())
    r.delete('nh:1')
    r.upsertHistory(up({ currentPage: 3 }))
    expect(r.get('nh:1')).not.toBeNull()
    expect(r.get('nh:1')!.deletedAt).toBeNull()
    expect(r.get('nh:1')!.currentPage).toBe(3)
  })

  it('hardDelete removes physically', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up())
    r.hardDelete('nh:1')
    expect(r.allIncludingDeleted()).toHaveLength(0)
  })

  it('clearHistory tombstones only status-null rows', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'nh:1' }))
    r.upsertHistory(up({ key: 'nh:2' }))
    r.setStatus('nh:2', 'reading')
    r.clearHistory()
    expect(r.get('nh:1')).toBeNull()
    expect(r.allIncludingDeleted().map((i) => i.key).sort()).toEqual(['nh:1', 'nh:2'])
    expect(r.get('nh:2')).not.toBeNull()
  })

  it('importItems lets a newer tombstone win', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up())
    const live = r.get('nh:1')!
    const tomb = { ...live, deletedAt: Date.now() + 1000, updatedAt: live.updatedAt + 2000 }
    const res = r.importItems([tomb])
    expect(res.updated).toBe(1)
    expect(r.get('nh:1')).toBeNull()
    expect(r.getIncludingDeleted('nh:1')!.deletedAt).not.toBeNull()
  })
})
```

`tests/db-migrate.test.ts` (pure migration helper, no native import — see Step 3):

```ts
import { describe, it, expect } from 'vitest'
import { needsDeletedAtColumn } from '../src/main/services/db-migrate'

describe('needsDeletedAtColumn', () => {
  it('true when column missing', () => {
    expect(needsDeletedAtColumn(1, ['key', 'url'])).toBe(true)
  })
  it('false when column present', () => {
    expect(needsDeletedAtColumn(1, ['key', 'deleted_at'])).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/series-repository-tombstone.test.ts tests/db-migrate.test.ts`
Expected: FAIL — `deletedAt` не существует / модуль `db-migrate` не найден.

- [ ] **Step 3: Implement**

`src/shared/library.ts` — добавить в `LibraryItem` после `updatedAt`:

```ts
  deletedAt: number | null
```

и в `SeriesUpsert` после `createdAt?`:

```ts
  deletedAt?: number | null
```

`src/main/services/series-repository.ts` — расширить интерфейс:

```ts
  allIncludingDeleted(): LibraryItem[]
  getIncludingDeleted(key: string): LibraryItem | null
  hardDelete(key: string): void
```

`BaseSeriesRepository`: добавить абстрактные `allIncludingDeleted`, `getIncludingDeleted`, `hardDelete`; `list` и `countByStatus` остаются на `all()` (уже без удалённых).

`InMemorySeriesRepository`: добавить `deletedAt: null` во все конструируемые строки; реализовать:

```ts
  allIncludingDeleted(): LibraryItem[] {
    return [...this.map.values()].map(clone)
  }

  getIncludingDeleted(key: string): LibraryItem | null {
    const v = this.map.get(key)
    return v ? clone(v) : null
  }

  all(): LibraryItem[] {
    return [...this.map.values()].filter((i) => i.deletedAt === null).map(clone)
  }

  get(key: string): LibraryItem | null {
    const v = this.map.get(key)
    return v && v.deletedAt === null ? clone(v) : null
  }

  findByUrl(url: string): LibraryItem | null {
    for (const v of this.map.values()) if (v.url === url && v.deletedAt === null) return clone(v)
    return null
  }
```

`upsertHistory`: искать через `this.map.get(item.key)` (включая tombstone), при обновлении `deletedAt: null`; при вставке `deletedAt: null`.

`delete(key)` → `this.patch(key, { deletedAt: Date.now() })`; добавить:

```ts
  hardDelete(key: string): void { this.map.delete(key) }
```

`clearHistory()`:

```ts
  clearHistory(): void {
    const now = Date.now()
    for (const v of this.map.values()) {
      if (v.status === null && v.deletedAt === null) { v.deletedAt = now; v.updatedAt = now }
    }
  }
```

`importItems`: сравнивать через `this.map.get(item.key)`; при `item.updatedAt > cur.updatedAt` — `this.map.set(item.key, clone(item))` (включая `deletedAt`).

`src/main/services/db-migrate.ts` (new, pure):

```ts
export function needsDeletedAtColumn(userVersion: number, columns: string[]): boolean {
  return userVersion < 2 && !columns.includes('deleted_at')
}
```

`src/main/services/db.ts`:
- в `SCHEMA` добавить `deleted_at INTEGER,` после `tags TEXT NOT NULL DEFAULT '[]',` (для новых БД);
- добавить миграцию и вызвать её после `db.exec(SCHEMA)`:

```ts
import { needsDeletedAtColumn } from './db-migrate'
// ...
function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  const cols = (db.pragma('table_info(series)') as { name: string }[]).map((c) => c.name)
  if (needsDeletedAtColumn(version, cols)) {
    db.exec('ALTER TABLE series ADD COLUMN deleted_at INTEGER')
  }
  db.pragma('user_version = 2')
}
```
и в `openAt` после `db.exec(SCHEMA)` вызвать `migrate(db)`.

`src/main/services/sqlite-series-repository.ts`:
- `rowToItem`: `deletedAt: r.deleted_at` (в `SeriesRow` добавить `deleted_at: number | null`);
- `all(): 'SELECT * FROM series WHERE deleted_at IS NULL'`;
- `allIncludingDeleted(): 'SELECT * FROM series'`;
- `get(key): '... WHERE key = ? AND deleted_at IS NULL'`;
- `getIncludingDeleted(key): '... WHERE key = ?'`;
- `findByUrl`: `WHERE url = ? AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1`;
- `upsertHistory`: `const existing = this.getIncludingDeleted(item.key)`; в UPDATE добавить `deleted_at = NULL`; в INSERT добавить колонку `deleted_at` со значением `NULL`;
- `delete(key)`: `UPDATE series SET deleted_at = ?, updated_at = ? WHERE key = ?` (`Date.now()`);
- `hardDelete(key)`: `DELETE FROM series WHERE key = ?`;
- `clearHistory()`: `UPDATE series SET deleted_at = ?, updated_at = ? WHERE status IS NULL AND deleted_at IS NULL`;
- `importItems`: `const cur = this.getIncludingDeleted(i.key)`; в INSERT/UPDATE добавить `deleted_at = @deleted_at` (`i.deletedAt ?? null`).

`src/main/services/history.ts`: `toHistoryEntry` не меняется (игнорирует deletedAt); `normalizeHistory` создаёт upsert без `deletedAt` — ок.

`src/main/services/library.ts`: `deleteSeries(key)` теперь мягкое удаление — без изменений кода (вызывает `repo.delete`).

`tests/backup.test.ts`: хелпер `item()` строит литерал `LibraryItem` — добавить `deletedAt: null`, иначе `typecheck` упадёт. Прогнать `rg -n "LibraryItem" tests` и добавить поле во все литералы `LibraryItem` (в других тестах таких литералов нет — проверить).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/series-repository-tombstone.test.ts tests/db-migrate.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Native migration smoke (manual, Electron ABI)**

Собрать `db.ts` через esbuild (как в плане library) и в Electron-ABI скрипте: создать БД, вставить строку, `openDatabase` повторно (миграция идемпотентна), проверить `PRAGMA user_version == 2` и что `deleted_at` есть. Зафиксировать вывод в отчёте.

- [ ] **Step 6: Commit**

```bash
git add src/shared/library.ts src/main/services/series-repository.ts src/main/services/sqlite-series-repository.ts src/main/services/db.ts src/main/services/db-migrate.ts tests/backup.test.ts tests/series-repository-tombstone.test.ts tests/db-migrate.test.ts
git commit -m "feat(sync): tombstone storage (deleted_at) with migration"
```

---

### Task 2: `sync-payload.ts` — снапшот и слияние

**Files:**
- Create: `src/main/services/sync-payload.ts`
- Test: `tests/sync-payload.test.ts`

**Interfaces:**
- Consumes: `LibraryItem` (Task 1), `Settings` (`@shared/settings`).
- Produces:
  - `SYNC_FORMAT = 'manga-reader-sync'`, `SYNC_VERSION = 1`.
  - `SyncSettings`, `SyncPayload`.
  - `extractSyncSettings(s: Settings): SyncSettings`
  - `applySyncSettings(s: Settings, sub: SyncSettings): Settings`
  - `buildSyncPayload(series: LibraryItem[], settings: Settings, settingsUpdatedAt: number): SyncPayload`
  - `mergeSyncPayload(local: SyncPayload, remote: SyncPayload): SyncPayload`
  - `parseSyncPayload(text: string): SyncPayload`

- [ ] **Step 1: Write the failing test**

`tests/sync-payload.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  buildSyncPayload, mergeSyncPayload, parseSyncPayload, extractSyncSettings, applySyncSettings,
  SYNC_FORMAT, SYNC_VERSION
} from '../src/main/services/sync-payload'
import { defaultSettings } from '../src/shared/settings'
import type { LibraryItem } from '../src/shared/library'

const item = (over: Partial<LibraryItem> = {}): LibraryItem => ({
  key: 'k', seriesId: 'k', url: 'u', title: 'T', coverUrl: null, source: 'S', category: 'main',
  currentPage: 1, totalPages: 0, chapterLabel: null, chapterIndex: null, chapterTotal: null,
  status: 'reading', note: '', rating: null, tags: [], openedAt: 1, createdAt: 1, updatedAt: 1,
  deletedAt: null, ...over
})

describe('sync settings subset', () => {
  it('extracts and applies portable fields only', () => {
    const s = { ...defaultSettings(), onion_cookies_raw: 'SECRET', downloads_dir: 'C:/x', width_scale: 0.5, reading_mode: 'Book' as const }
    const sub = extractSyncSettings(s)
    expect(sub.width_scale).toBe(0.5)
    expect((sub as any).onion_cookies_raw).toBeUndefined()
    const back = applySyncSettings(s, { ...sub, width_scale: 0.9 })
    expect(back.width_scale).toBe(0.9)
    expect(back.onion_cookies_raw).toBe('SECRET') // not touched
  })
})

describe('mergeSyncPayload', () => {
  it('newest updatedAt wins per key, including tombstones', () => {
    const local = buildSyncPayload([item({ key: 'a', title: 'L', updatedAt: 10 })], defaultSettings(), 5)
    const remote = buildSyncPayload(
      [item({ key: 'a', title: 'R', updatedAt: 20 }), item({ key: 'b', title: 'B', updatedAt: 1 }), item({ key: 'c', deletedAt: 99, updatedAt: 99 })],
      defaultSettings(), 5
    )
    const m = mergeSyncPayload(local, remote)
    const byKey = Object.fromEntries(m.series.map((i) => [i.key, i]))
    expect(byKey.a.title).toBe('R')
    expect(byKey.b.title).toBe('B')
    expect(byKey.c.deletedAt).toBe(99)
  })

  it('takes settings from the newer settingsUpdatedAt', () => {
    const a = buildSyncPayload([], { ...defaultSettings(), width_scale: 0.4 }, 10)
    const b = buildSyncPayload([], { ...defaultSettings(), width_scale: 0.8 }, 20)
    expect(mergeSyncPayload(a, b).settings.width_scale).toBe(0.8)
    expect(mergeSyncPayload(b, a).settings.width_scale).toBe(0.8)
  })
})

describe('parseSyncPayload', () => {
  it('rejects wrong format/version and validates series', () => {
    expect(() => parseSyncPayload('{}')).toThrow()
    expect(() => parseSyncPayload(JSON.stringify({ format: SYNC_FORMAT, version: 999 }))).toThrow()
    const ok = JSON.stringify(buildSyncPayload([item()], defaultSettings(), 1))
    expect(parseSyncPayload(ok).series).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-payload.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/services/sync-payload.ts`**

```ts
import type { LibraryItem } from '@shared/library'
import type { Settings } from '@shared/settings'

export const SYNC_FORMAT = 'manga-reader-sync' as const
export const SYNC_VERSION = 1

export interface SyncSettings {
  reading_mode: 'Scroll' | 'Book'
  book_direction: 'Ltr' | 'Rtl'
  width_scale: number
  pages_per_screen: number
  page_margin: number
  infinite_scroll: boolean
  nhentai_show_page_counts: boolean
  show_thumbnails: boolean
  thumb_size: number
  show_r34_history: boolean
  library_auto_add: boolean
}

export interface SyncPayload {
  format: typeof SYNC_FORMAT
  version: number
  updatedAt: number
  series: LibraryItem[]
  settings: SyncSettings
  settingsUpdatedAt: number
}

export function extractSyncSettings(s: Settings): SyncSettings {
  return {
    reading_mode: s.reading_mode, book_direction: s.book_direction, width_scale: s.width_scale,
    pages_per_screen: s.pages_per_screen, page_margin: s.page_margin, infinite_scroll: s.infinite_scroll,
    nhentai_show_page_counts: s.nhentai_show_page_counts, show_thumbnails: s.show_thumbnails,
    thumb_size: s.thumb_size, show_r34_history: s.show_r34_history, library_auto_add: s.library_auto_add
  }
}

export function applySyncSettings(s: Settings, sub: SyncSettings): Settings {
  return { ...s, ...sub }
}

export function buildSyncPayload(series: LibraryItem[], settings: Settings, settingsUpdatedAt: number): SyncPayload {
  return {
    format: SYNC_FORMAT, version: SYNC_VERSION, updatedAt: Date.now(),
    series: series.map((i) => ({ ...i, tags: [...i.tags] })),
    settings: extractSyncSettings(settings), settingsUpdatedAt
  }
}

export function mergeSyncPayload(local: SyncPayload, remote: SyncPayload): SyncPayload {
  const map = new Map<string, LibraryItem>()
  for (const i of local.series) map.set(i.key, i)
  for (const i of remote.series) {
    const cur = map.get(i.key)
    if (!cur || i.updatedAt > cur.updatedAt) map.set(i.key, i)
  }
  const remoteWins = remote.settingsUpdatedAt > local.settingsUpdatedAt
  return {
    format: SYNC_FORMAT, version: SYNC_VERSION,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    series: [...map.values()],
    settings: remoteWins ? remote.settings : local.settings,
    settingsUpdatedAt: remoteWins ? remote.settingsUpdatedAt : local.settingsUpdatedAt
  }
}

export function parseSyncPayload(text: string): SyncPayload {
  let obj: any
  try { obj = JSON.parse(text) } catch { throw new Error('Файл синхронизации повреждён (не JSON)') }
  if (!obj || obj.format !== SYNC_FORMAT) throw new Error('Это не файл синхронизации Manga Reader')
  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 1 || obj.version > SYNC_VERSION) {
    throw new Error(`Неподдерживаемая версия синхронизации: ${obj.version}`)
  }
  if (!Array.isArray(obj.series)) throw new Error('Файл синхронизации повреждён: нет series')
  for (const s of obj.series) {
    if (!s || typeof s !== 'object' || typeof s.key !== 'string' || !s.key || typeof s.url !== 'string' || typeof s.title !== 'string') {
      throw new Error('Файл синхронизации повреждён: некорректная запись')
    }
  }
  if (!obj.settings || typeof obj.settings !== 'object' || Array.isArray(obj.settings)) {
    throw new Error('Файл синхронизации повреждён: нет настроек')
  }
  return obj as SyncPayload
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/sync-payload.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/sync-payload.ts tests/sync-payload.test.ts
git commit -m "feat(sync): sync payload build/merge/parse (pure)"
```

---

### Task 3: `google-auth.ts` — OAuth 2.0 (PKCE, loopback, `safeStorage`)

**Files:**
- Create: `src/main/services/google-config.ts`
- Create: `src/main/services/google-auth.ts`
- Modify: `src/main/services/db.ts`? — нет.
- Test: `tests/google-auth.test.ts`

**Interfaces:**
- Consumes: `BrowserWindow`, `safeStorage` (electron); Node `http`, `crypto`.
- Produces:
  - `GOOGLE_CLIENT_ID: string`, `GOOGLE_SCOPE: string`, `GOOGLE_AUTH_ENDPOINT`, `GOOGLE_TOKEN_ENDPOINT`, `GOOGLE_REVOKE_ENDPOINT`, `GOOGLE_USERINFO_ENDPOINT`.
  - `buildCodeVerifier(): string`, `codeChallenge(verifier: string): string`, `base64url(buf: Buffer): string`
  - `buildAuthUrl(clientId: string, redirectUri: string, challenge: string): string`
  - `parseLoopbackQuery(url: string): { code: string | null; error: string | null }`
  - class `GoogleAuth`: `constructor(userDataDir: string)`, `status(): { authed: boolean; email: string | null }`, `login(): Promise<{ email: string }>`, `getAccessToken(): Promise<string>`, `logout(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`tests/google-auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildCodeVerifier, codeChallenge, buildAuthUrl, parseLoopbackQuery } from '../src/main/services/google-auth'

describe('PKCE', () => {
  it('verifier is url-safe and challenge is deterministic base64url sha256', () => {
    const v = buildCodeVerifier()
    expect(v).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    const c = codeChallenge(v)
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(codeChallenge(v)).toBe(c)
    expect(c).not.toContain('=')
  })
})

describe('buildAuthUrl', () => {
  it('contains required params', () => {
    const u = new URL(buildAuthUrl('CID', 'http://127.0.0.1:1234', 'CHAL'))
    expect(u.hostname).toBe('accounts.google.com')
    expect(u.searchParams.get('client_id')).toBe('CID')
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1234')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('code_challenge')).toBe('CHAL')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
    expect(u.searchParams.get('scope')).toContain('drive.appdata')
  })
})

describe('parseLoopbackQuery', () => {
  it('extracts code and error', () => {
    expect(parseLoopbackQuery('http://127.0.0.1:5/?code=abc&scope=x').code).toBe('abc')
    expect(parseLoopbackQuery('http://127.0.0.1:5/?error=access_denied').error).toBe('access_denied')
    expect(parseLoopbackQuery('http://127.0.0.1:5/?code=a').error).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/google-auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/services/google-config.ts`:

```ts
export const GOOGLE_CLIENT_ID = '59705917238-2tditham9qpns2gl7tecarqh77krg5bt.apps.googleusercontent.com'
export const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/drive.appdata'
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
export const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo'
```

`src/main/services/google-auth.ts`:

```ts
import { BrowserWindow, safeStorage } from 'electron'
import { createServer } from 'http'
import { randomBytes, createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import {
  GOOGLE_CLIENT_ID, GOOGLE_SCOPE, GOOGLE_AUTH_ENDPOINT, GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_REVOKE_ENDPOINT, GOOGLE_USERINFO_ENDPOINT
} from './google-config'

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function buildCodeVerifier(): string {
  return base64url(randomBytes(48))
}
export function codeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}
export function buildAuthUrl(clientId: string, redirectUri: string, challenge: string): string {
  const u = new URL(GOOGLE_AUTH_ENDPOINT)
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', GOOGLE_SCOPE)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  return u.toString()
}
export function parseLoopbackQuery(url: string): { code: string | null; error: string | null } {
  try {
    const u = new URL(url)
    return { code: u.searchParams.get('code'), error: u.searchParams.get('error') }
  } catch {
    return { code: null, error: 'bad_redirect' }
  }
}

interface StoredTokens {
  refresh_token: string
  access_token: string
  expires_at: number
  email: string
}

export class GoogleAuth {
  private path: string
  private tokens: StoredTokens | null

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'google-auth.bin')
    this.tokens = this.read()
  }

  private read(): StoredTokens | null {
    if (!existsSync(this.path)) return null
    try {
      const raw = readFileSync(this.path)
      const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
      return JSON.parse(text) as StoredTokens
    } catch { return null }
  }

  private write(t: StoredTokens | null): void {
    this.tokens = t
    if (!t) { try { rmSync(this.path) } catch { /* ignore */ } return }
    mkdirSync(join(this.path, '..'), { recursive: true })
    const text = JSON.stringify(t)
    if (safeStorage.isEncryptionAvailable()) writeFileSync(this.path, safeStorage.encryptString(text))
    else writeFileSync(this.path, text, 'utf8')
  }

  status(): { authed: boolean; email: string | null } {
    return { authed: !!this.tokens?.refresh_token, email: this.tokens?.email ?? null }
  }

  private captureCode(challenge: string): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let settled = false
      let win: BrowserWindow | null = null
      const done = (fn: () => void): void => { if (!settled) { settled = true; fn() } }
      const server = createServer((req, res) => {
        const parsed = parseLoopbackQuery(`http://127.0.0.1${req.url ?? '/'}`)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body style="font-family:sans-serif">Можно закрыть окно и вернуться в приложение.</body></html>')
        try { server.close() } catch { /* ignore */ }
        if (win && !win.isDestroyed()) win.close()
        if (parsed.code) done(() => resolve({ code: parsed.code!, redirectUri }))
        else done(() => reject(new Error(parsed.error === 'access_denied' ? 'Доступ отклонён пользователем' : `Ошибка авторизации: ${parsed.error ?? 'unknown'}`)))
      })
      server.on('error', (e) => done(() => reject(e)))
      let redirectUri = ''
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (!addr || typeof addr === 'string') { done(() => reject(new Error('Не удалось запустить loopback-сервер'))); return }
        redirectUri = `http://127.0.0.1:${addr.port}`
        win = new BrowserWindow({ width: 520, height: 720, title: 'Вход через Google', autoHideMenuBar: true, webPreferences: { partition: 'persist:google-oauth' } })
        win.on('closed', () => { try { server.close() } catch { /* ignore */ }; done(() => reject(new Error('Окно входа закрыто'))) })
        void win.loadURL(buildAuthUrl(GOOGLE_CLIENT_ID, redirectUri, challenge))
      })
    })
  }

  async login(): Promise<{ email: string }> {
    const verifier = buildCodeVerifier()
    const challenge = codeChallenge(verifier)
    const { code, redirectUri } = await this.captureCode(challenge)

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID, code, code_verifier: verifier,
        grant_type: 'authorization_code', redirect_uri: redirectUri
      }).toString()
    })
    if (!res.ok) throw new Error(`Обмен кода не удался (HTTP ${res.status})`)
    const tok = await res.json() as { access_token: string; refresh_token?: string; expires_in: number }
    if (!tok.refresh_token) throw new Error('Google не выдал refresh-token (нужен prompt=consent)')
    let email = ''
    try {
      const ui = await fetch(GOOGLE_USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${tok.access_token}` } })
      if (ui.ok) email = (await ui.json() as { email?: string }).email ?? ''
    } catch { /* email необязателен */ }
    this.write({ refresh_token: tok.refresh_token, access_token: tok.access_token, expires_at: Date.now() + tok.expires_in * 1000, email })
    return { email }
  }

  async getAccessToken(): Promise<string> {
    const t = this.tokens
    if (!t) throw new Error('Не выполнен вход в Google')
    if (t.access_token && Date.now() < t.expires_at - 60_000) return t.access_token
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, refresh_token: t.refresh_token, grant_type: 'refresh_token' }).toString()
    })
    if (!res.ok) throw new Error(`Обновление токена не удалось (HTTP ${res.status})`)
    const tok = await res.json() as { access_token: string; expires_in: number }
    this.write({ ...t, access_token: tok.access_token, expires_at: Date.now() + tok.expires_in * 1000 })
    return tok.access_token
  }

  async logout(): Promise<void> {
    const t = this.tokens
    if (t?.refresh_token) {
      try { await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST' }) } catch { /* ignore */ }
    }
    this.write(null)
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/google-auth.test.ts && npm run typecheck`
Expected: PASS. (Тест импортирует только чистые функции; класс не инстанцируется.)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/google-config.ts src/main/services/google-auth.ts tests/google-auth.test.ts
git commit -m "feat(sync): Google OAuth (PKCE loopback) with safeStorage token store"
```

---

### Task 4: `google-drive.ts` — один файл в `appDataFolder`

**Files:**
- Create: `src/main/services/google-drive.ts`
- Test: `tests/google-drive.test.ts`

**Interfaces:**
- Consumes: `GoogleAuth.getAccessToken()` (Task 3).
- Produces: class `GoogleDrive`:
  - `constructor(auth: Pick<GoogleAuth, 'getAccessToken'>)`
  - `findSyncFile(): Promise<string | null>`
  - `download(): Promise<string | null>`
  - `upload(content: string): Promise<void>`
  - экспорт `SYNC_FILE_NAME = 'manga-reader-sync.json'`
  - инъекция транспорта: `constructor(auth, fetchImpl: typeof fetch = fetch)` для тестов.

- [ ] **Step 1: Write the failing test**

`tests/google-drive.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { GoogleDrive, SYNC_FILE_NAME } from '../src/main/services/google-drive'

const auth = { getAccessToken: async () => 'TOKEN' }

describe('GoogleDrive', () => {
  it('upload creates when no file exists', async () => {
    const calls: string[] = []
    const f = vi.fn(async (url: any, init: any) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`)
      if (String(url).includes('/drive/v3/files?') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ files: [] }), { status: 200 })
      }
      if (String(url).includes('/upload/drive/v3/files')) {
        return new Response(JSON.stringify({ id: 'NEW' }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const d = new GoogleDrive(auth, f)
    await d.upload('{"x":1}')
    expect(calls.some((c) => c.includes('POST') && c.includes('/upload/drive/v3/files'))).toBe(true)
  })

  it('download returns media text or null when absent', async () => {
    const f = vi.fn(async (url: any, init: any) => {
      if (String(url).includes('/drive/v3/files?')) return new Response(JSON.stringify({ files: [{ id: 'F1' }] }), { status: 200 })
      if (String(url).includes('/drive/v3/files/F1') && (init?.method ?? 'GET') === 'GET') return new Response('{"format":"manga-reader-sync"}', { status: 200 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const d = new GoogleDrive(auth, f)
    expect(await d.download()).toContain('manga-reader-sync')
  })

  it('retries once on 401', async () => {
    let n = 0
    const f = vi.fn(async (url: any) => {
      n++
      if (String(url).includes('/drive/v3/files?')) return new Response(JSON.stringify({ files: [] }), { status: 200 })
      if (n < 3) return new Response('unauth', { status: 401 })
      return new Response(JSON.stringify({ id: 'X' }), { status: 200 })
    }) as unknown as typeof fetch
    const d = new GoogleDrive(auth, f)
    await d.upload('x') // must not throw
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/google-drive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/services/google-drive.ts`**

```ts
import type { GoogleAuth } from './google-auth'

export const SYNC_FILE_NAME = 'manga-reader-sync.json'
const FILES_API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'

type FetchLike = typeof fetch

export class GoogleDrive {
  constructor(
    private auth: Pick<GoogleAuth, 'getAccessToken'>,
    private fetchImpl: FetchLike = fetch
  ) {}

  private async req(url: string, init: RequestInit): Promise<Response> {
    const token = await this.auth.getAccessToken()
    const headers = { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` }
    let res = await this.fetchImpl(url, { ...init, headers })
    if (res.status === 401) {
      const t2 = await this.auth.getAccessToken()
      res = await this.fetchImpl(url, { ...init, headers: { ...headers, Authorization: `Bearer ${t2}` } })
    }
    return res
  }

  async findSyncFile(): Promise<string | null> {
    const q = encodeURIComponent(`name='${SYNC_FILE_NAME}'`)
    const res = await this.req(`${FILES_API}?spaces=appDataFolder&q=${q}&fields=files(id,name)`, { method: 'GET' })
    if (!res.ok) throw new Error(`Drive list не удался (HTTP ${res.status})`)
    const j = await res.json() as { files?: { id: string }[] }
    return j.files?.[0]?.id ?? null
  }

  async download(): Promise<string | null> {
    const id = await this.findSyncFile()
    if (!id) return null
    const res = await this.req(`${FILES_API}/${id}?alt=media`, { method: 'GET' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Drive download не удался (HTTP ${res.status})`)
    return await res.text()
  }

  async upload(content: string): Promise<void> {
    const id = await this.findSyncFile()
    const boundary = 'mangareadersync'
    const meta = id ? { name: SYNC_FILE_NAME } : { name: SYNC_FILE_NAME, parents: ['appDataFolder'] }
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`
    const url = id ? `${UPLOAD_API}/${id}?uploadType=multipart` : `${UPLOAD_API}?uploadType=multipart`
    const res = await this.req(url, {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    })
    if (!res.ok) throw new Error(`Drive upload не удался (HTTP ${res.status})`)
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/google-drive.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/google-drive.ts tests/google-drive.test.ts
git commit -m "feat(sync): Google Drive appDataFolder client (single sync file)"
```

---

### Task 5: `sync.ts` — оркестрация (pull→merge→apply→push)

**Files:**
- Create: `src/shared/sync.ts`
- Create: `src/main/services/sync.ts`
- Test: `tests/sync-service.test.ts`

**Interfaces:**
- Consumes: `SeriesRepository` (`allIncludingDeleted`, `importItems`), `Settings`/`saveSettings`, `sync-payload` (Task 2), `GoogleDrive`/`GoogleAuth` (Tasks 3–4).
- Produces: class `SyncService`:
  - `constructor(deps: SyncDeps)`
  - `getState(): SyncState`
  - `syncNow(): Promise<SyncState>`
  - `scheduleSync(): void` (debounce 10 c)
  - `markSettingsChanged(): void` (обновляет `settingsUpdatedAt`)
  - export `SyncState = { state: 'idle'|'syncing'|'error'; lastSyncAt: number | null; email: string | null; lastError: string | null }`

- [ ] **Step 1: Write the failing test**

`tests/sync-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { SyncService } from '../src/main/services/sync'
import { InMemorySeriesRepository } from '../src/main/services/series-repository'
import { buildSyncPayload } from '../src/main/services/sync-payload'
import { defaultSettings } from '../src/shared/settings'

function make(remoteText: string | null) {
  const repo = new InMemorySeriesRepository()
  let settings = defaultSettings()
  const uploaded: string[] = []
  const drive = {
    download: async () => remoteText,
    upload: async (c: string) => { uploaded.push(c) }
  }
  const svc = new SyncService({
    repo,
    getSettings: () => settings,
    saveSettings: (s) => { settings = s },
    getSettingsUpdatedAt: () => 1,
    drive: drive as any,
    authStatus: () => ({ authed: true, email: 'a@b.c' }),
    onChanged: () => {}
  })
  return { svc, repo, uploaded, getSettings: () => settings }
}

describe('SyncService.syncNow', () => {
  it('merges remote into local and uploads merged', async () => {
    const remote = buildSyncPayload(
      [{ key: 'r1', seriesId: 'r1', url: 'u1', title: 'R', coverUrl: null, source: 'S', category: 'main', currentPage: 1, totalPages: 0, chapterLabel: null, chapterIndex: null, chapterTotal: null, status: 'planned', note: '', rating: null, tags: [], openedAt: 1, createdAt: 1, updatedAt: 2, deletedAt: null }],
      { ...defaultSettings(), width_scale: 0.7 }, 100
    )
    const { svc, repo, uploaded, getSettings } = make(JSON.stringify(remote))
    const st = await svc.syncNow()
    expect(st.state).toBe('idle')
    expect(repo.get('r1')).not.toBeNull()
    expect(getSettings().width_scale).toBe(0.7)
    expect(uploaded).toHaveLength(1)
  })

  it('uploads local when remote is empty', async () => {
    const { svc, uploaded } = make(null)
    await svc.syncNow()
    expect(uploaded).toHaveLength(1)
  })

  it('sets error state on drive failure', async () => {
    const repo = new InMemorySeriesRepository()
    const svc = new SyncService({
      repo, getSettings: defaultSettings, saveSettings: () => {}, getSettingsUpdatedAt: () => 0,
      drive: { download: async () => { throw new Error('boom') }, upload: async () => {} } as any,
      authStatus: () => ({ authed: true, email: 'a@b.c' }), onChanged: () => {}
    })
    const st = await svc.syncNow()
    expect(st.state).toBe('error')
    expect(st.lastError).toContain('boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Сначала создать `src/shared/sync.ts`:

```ts
export interface SyncState {
  state: 'idle' | 'syncing' | 'error'
  lastSyncAt: number | null
  email: string | null
  lastError: string | null
}
```

Затем `src/main/services/sync.ts`:

```ts
import type { SeriesRepository } from './series-repository'
import type { Settings } from '@shared/settings'
import type { SyncState } from '@shared/sync'
import {
  buildSyncPayload, mergeSyncPayload, parseSyncPayload, applySyncSettings,
  extractSyncSettings
} from './sync-payload'

interface DriveLike {
  download(): Promise<string | null>
  upload(content: string): Promise<void>
}

export interface SyncDeps {
  repo: SeriesRepository
  getSettings: () => Settings
  saveSettings: (s: Settings) => void
  getSettingsUpdatedAt: () => number
  drive: DriveLike
  authStatus: () => { authed: boolean; email: string | null }
  onChanged: (s: SyncState) => void
}

const DEBOUNCE_MS = 10_000

export class SyncService {
  private state: SyncState
  private inFlight: Promise<SyncState> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private settingsUpdatedAt: number

  constructor(private deps: SyncDeps) {
    this.settingsUpdatedAt = deps.getSettingsUpdatedAt()
    this.state = { state: 'idle', lastSyncAt: null, email: deps.authStatus().email, lastError: null }
  }

  getState(): SyncState { return { ...this.state } }

  markSettingsChanged(): void { this.settingsUpdatedAt = Date.now() }

  scheduleSync(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; void this.syncNow() }, DEBOUNCE_MS)
  }

  async syncNow(): Promise<SyncState> {
    if (this.inFlight) return this.inFlight
    this.set({ state: 'syncing', lastError: null })
    this.inFlight = (async () => {
      try {
        const remoteText = await this.deps.drive.download()
        const local = buildSyncPayload(this.deps.repo.allIncludingDeleted(), this.deps.getSettings(), this.settingsUpdatedAt)
        const merged = remoteText ? mergeSyncPayload(local, parseSyncPayload(remoteText)) : local
        this.deps.repo.importItems(merged.series)
        if (merged.settingsUpdatedAt >= this.settingsUpdatedAt) {
          this.deps.saveSettings(applySyncSettings(this.deps.getSettings(), merged.settings))
          this.settingsUpdatedAt = merged.settingsUpdatedAt
        }
        await this.deps.drive.upload(JSON.stringify(merged))
        this.set({ state: 'idle', lastSyncAt: Date.now(), email: this.deps.authStatus().email, lastError: null })
      } catch (e: any) {
        this.set({ state: 'error', lastError: e?.message ?? String(e) })
      } finally {
        this.inFlight = null
      }
      return this.getState()
    })()
    return this.inFlight
  }

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch }
    this.deps.onChanged(this.getState())
  }
}

export function isPortableSettingsChanged(a: Settings, b: Settings): boolean {
  return JSON.stringify(extractSyncSettings(a)) !== JSON.stringify(extractSyncSettings(b))
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/sync-service.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/sync.ts tests/sync-service.test.ts
git commit -m "feat(sync): orchestration service (pull/merge/apply/push, debounce)"
```

---

### Task 6: IPC + preload + проводка в main

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/settings.ts`, `src/main/index.ts`
- Test: `tests/ipc-sync.test.ts`

**Interfaces:**
- Consumes: `GoogleAuth` (Task 3), `GoogleDrive` (Task 4), `SyncService` (Task 5).
- Produces: каналы `googleAuthStatus`, `googleLogin`, `googleLogout`, `syncNow`, `syncGetState`, событие `syncChanged`; методы `Api`; `Settings.sync_enabled`/`sync_auto`.

- [ ] **Step 1: Write the failing test**

`tests/ipc-sync.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CH } from '../src/shared/ipc'
import { defaultSettings, parseSettings } from '../src/shared/settings'

describe('sync IPC channels', () => {
  it('exposes channels', () => {
    expect(CH.googleAuthStatus).toBe('google:status')
    expect(CH.googleLogin).toBe('google:login')
    expect(CH.googleLogout).toBe('google:logout')
    expect(CH.syncNow).toBe('sync:now')
    expect(CH.syncGetState).toBe('sync:state')
    expect(CH.syncChanged).toBe('sync:changed')
  })
})

describe('sync settings', () => {
  it('defaults', () => {
    expect(defaultSettings().sync_enabled).toBe(false)
    expect(defaultSettings().sync_auto).toBe(true)
    expect(parseSettings({ sync_enabled: true, sync_auto: false }).sync_auto).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ipc-sync.test.ts`
Expected: FAIL — properties missing.

- [ ] **Step 3: Implement**

`src/shared/settings.ts`: добавить `sync_enabled: boolean`, `sync_auto: boolean` в `Settings`; в `defaultSettings` — `sync_enabled: false, sync_auto: true`; в `parseSettings` — `sync_enabled: bool(o.sync_enabled, false), sync_auto: bool(o.sync_auto, true)`.

`src/shared/ipc.ts`: импорт `import type { SyncState } from './sync'` (файл создан в Task 5); добавить интерфейс:

```ts
export interface GoogleAuthStatus { authed: boolean; email: string | null }
```
`Api`:

```ts
  googleAuthStatus(): Promise<GoogleAuthStatus>
  googleLogin(): Promise<GoogleAuthStatus>
  googleLogout(): Promise<void>
  syncNow(): Promise<SyncState>
  syncGetState(): Promise<SyncState>
  onSyncChanged(cb: (s: SyncState) => void): () => void
```
`CH`:

```ts
  googleAuthStatus: 'google:status',
  googleLogin: 'google:login',
  googleLogout: 'google:logout',
  syncNow: 'sync:now',
  syncGetState: 'sync:state',
  syncChanged: 'sync:changed',
```

`src/shared/sync.ts` создан в Task 5; `src/main/services/sync.ts` уже импортирует `SyncState` из `@shared/sync`.

`src/preload/index.ts`:

```ts
  googleAuthStatus: () => ipcRenderer.invoke(CH.googleAuthStatus),
  googleLogin: () => ipcRenderer.invoke(CH.googleLogin),
  googleLogout: () => ipcRenderer.invoke(CH.googleLogout),
  syncNow: () => ipcRenderer.invoke(CH.syncNow),
  syncGetState: () => ipcRenderer.invoke(CH.syncGetState),
  onSyncChanged: (cb) => {
    const fn = (_e: unknown, s: import('@shared/sync').SyncState): void => cb(s)
    ipcRenderer.on(CH.syncChanged, fn)
    return () => ipcRenderer.removeListener(CH.syncChanged, fn)
  },
```

`src/main/index.ts` (внутри `app.whenReady`):
- импорты: `import { GoogleAuth } from './services/google-auth'`, `import { GoogleDrive } from './services/google-drive'`, `import { SyncService } from './services/sync'`, `import { isPortableSettingsChanged } from './services/sync'`.
- после `library = new LibraryService(...)`:

```ts
  const googleAuth = new GoogleAuth(app.getPath('userData'))
  const googleDrive = new GoogleDrive(googleAuth)
  const syncStatePath = join(app.getPath('userData'), 'sync-state.json')
  let settingsUpdatedAt = Date.now()
  try { settingsUpdatedAt = JSON.parse(readFileSync(syncStatePath, 'utf8')).settingsUpdatedAt ?? settingsUpdatedAt } catch { /* ignore */ }
  const persistSyncState = (): void => { try { writeFileSync(syncStatePath, JSON.stringify({ settingsUpdatedAt })) } catch { /* ignore */ } }
  sync = new SyncService({
    repo,
    getSettings: () => settings.get(),
    saveSettings: (s) => { settings.save(s); for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.settingsChanged, s) },
    getSettingsUpdatedAt: () => settingsUpdatedAt,
    drive: googleDrive,
    authStatus: () => googleAuth.status(),
    onChanged: (st) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.syncChanged, st) }
  })
  ipcMain.handle(CH.googleAuthStatus, () => googleAuth.status())
  ipcMain.handle(CH.googleLogin, async () => { const r = await googleAuth.login(); return googleAuth.status() })
  ipcMain.handle(CH.googleLogout, async () => { await googleAuth.logout() })
  ipcMain.handle(CH.syncNow, () => sync!.syncNow())
  ipcMain.handle(CH.syncGetState, () => sync!.getState())
  if (settings.get().sync_enabled && googleAuth.status().authed) {
    setTimeout(() => { void sync!.syncNow() }, 3000)
  }
```
- объявить `let sync: SyncService` рядом с прочими.
- в `CH.setSettings` handler: если `isPortableSettingsChanged(prevSettings, s)` → `settingsUpdatedAt = Date.now(); persistSyncState(); if (s.sync_auto) sync?.scheduleSync()`.
- в `broadcastLibrary()` (или после мутаций библиотеки): если `settings.get().sync_auto && settings.get().sync_enabled` → `sync?.scheduleSync()`.
- в `recordProgress` handler — тот же вызов после сохранения.
- импорт `join` уже есть; `readFileSync`/`writeFileSync` — добавить в импорт `fs`.

> `persistSyncState` хранит `settingsUpdatedAt`; при старте читается. Простейший вариант без отдельной обёртки — файл `sync-state.json` с одним полем.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/ipc-sync.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/shared/settings.ts src/main/index.ts tests/ipc-sync.test.ts
git commit -m "feat(sync): IPC channels, preload API and main wiring"
```

---

### Task 7: Секция «Синхронизация» в Settings

**Files:**
- Modify: `src/renderer/src/screens/Settings.tsx`
- Test: ручной (UI)

**Interfaces:**
- Consumes: `window.api.googleAuthStatus/googleLogin/googleLogout/syncNow/syncGetState/onSyncChanged` (Task 6), `settings.sync_enabled/sync_auto`.

- [ ] **Step 1: Добавить состояние и подписку**

В `Settings.tsx`:

```tsx
  const [google, setGoogle] = useState<{ authed: boolean; email: string | null }>({ authed: false, email: null })
  const [syncState, setSyncState] = useState<import('@shared/sync').SyncState>({ state: 'idle', lastSyncAt: null, email: null, lastError: null })
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  useEffect(() => {
    window.api.googleAuthStatus().then(setGoogle)
    window.api.syncGetState().then(setSyncState)
    return window.api.onSyncChanged(setSyncState)
  }, [])
```

- [ ] **Step 2: Добавить секцию**

```tsx
        <Section title="Синхронизация (Google Drive)">
          {!google.authed ? (
            <>
              <div className="row">
                <button onClick={async () => {
                  setSyncMsg('Открываю окно входа Google…')
                  try { const r = await window.api.googleLogin(); setGoogle(r); setSyncMsg('Вход выполнен') }
                  catch (e: any) { setSyncMsg(`Ошибка: ${e?.message ?? e}`) }
                }}>Войти через Google</button>
              </div>
              <div className="row muted">Синхронизирует библиотеку и прогресс через вашу папку Google Drive.</div>
            </>
          ) : (
            <>
              <div className="row">
                <label>Аккаунт:</label><span className="muted">{google.email || '—'}</span>
              </div>
              <div className="row">
                <label>Последняя синхронизация:</label>
                <span className="muted">{syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleString() : 'ещё не было'}</span>
              </div>
              <div className="row">
                <Toggle checked={settings.sync_enabled} onChange={(v) => upd({ sync_enabled: v })}>Включить синхронизацию</Toggle>
              </div>
              <div className="row">
                <Toggle checked={settings.sync_auto} onChange={(v) => upd({ sync_auto: v })}>Авто-синхронизация</Toggle>
              </div>
              <div className="row">
                <button disabled={syncState.state === 'syncing'} onClick={async () => {
                  setSyncMsg('Синхронизирую…')
                  try { await window.api.syncNow(); setSyncMsg('Готово') } catch (e: any) { setSyncMsg(`Ошибка: ${e?.message ?? e}`) }
                }}>{syncState.state === 'syncing' ? 'Синхронизация…' : 'Синхронизировать сейчас'}</button>
                <button onClick={async () => { await window.api.googleLogout(); setGoogle({ authed: false, email: null }); setSyncMsg('Вы вышли из Google') }}>Выйти</button>
              </div>
            </>
          )}
          {syncState.lastError && <div className="row muted">Ошибка синка: {syncState.lastError}</div>}
          {syncMsg && <div className="row muted">{syncMsg}</div>}
        </Section>
```

- [ ] **Step 3: Проверка + коммит**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/renderer/src/screens/Settings.tsx
git commit -m "feat(sync): Settings section (Google login, sync now, auto toggles)"
```

---

### Task 8: Финальная проверка

**Files:** —

- [ ] **Step 1: Полный прогон**

Run: `npm run typecheck && npm test`
Expected: PASS без пропусков.

- [ ] **Step 2: Ручной smoke с реальным Google (пользователь)**

1. `npm run dev` → Settings → «Войти через Google» → вход, согласие (предупреждение «unverified» допустимо).
2. Добавить галерею в библиотеку → «Синхронизировать сейчас» → в Google Drive (в скрытой папке приложения) появляется `manga-reader-sync.json`.
3. На втором устройстве: тот же аккаунт → «Войти» → «Синхронизировать сейчас» → записи появляются.
4. Удалить запись на устройстве A → синк → на B запись исчезает (tombstone).
5. «Выйти» → токен отозван (в аккаунте Google приложение исчезает из списка).

- [ ] **Step 3: Commit (если остались правки)**

```bash
git status --short
git add -A
git commit -m "chore: manual smoke fixes for Google Drive sync"
```

---

## Self-Review

**Покрытие спеки:**
- Ф-1 Google Auth (PKCE, loopback, safeStorage) → Task 3.
- Ф-2 Drive (appDataFolder, один файл) → Task 4.
- Ф-3 Payload/merge (+ `SyncSettings`, `parseSyncPayload`) → Task 2.
- Ф-4 Tombstone + миграция → Task 1.
- Ф-5 Оркестрация (syncNow, debounce, syncOnStart) → Tasks 5, 6.
- Ф-6 Настройки/UI → Tasks 6, 7.
- IPC/типы → Task 6.
- Безопасность (safeStorage, revoke, appdata) → Tasks 3, 4.
- Тесты (payload/merge/tombstone/PKCE/drive) → Tasks 1–5; ручной OAuth smoke → Task 8.

**Типы:** `SyncState` объявлен в `src/shared/sync.ts` и используется в `sync.ts`/`ipc.ts`/`preload`; `LibraryItem.deletedAt` — везде; `SeriesRepository` новые методы реализованы в обоих репозиториях.

**Известные упрощения (документированы):** список загрузок исключён; один Google-аккаунт; tombstone'ы не очищаются; last-write-wins при конфликте одной записи. Плейсхолдеров нет.
