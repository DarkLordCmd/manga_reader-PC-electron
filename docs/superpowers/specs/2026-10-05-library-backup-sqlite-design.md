# Библиотека (избранное/статусы) + бэкап + SQLite — Design Spec

Дата: 2026-10-05
Статус: approved

Три связанные фичи, вдохновлённые JHenTai (favorites: категории/заметки/рейтинг,
`_exportData`/`_importData`/configSync) и MangaNet (`ReadingListPage`, статусы чтения):

1. **Библиотека** — экран избранного со статусами, заметками, оценкой и тегами.
2. **Бэкап** — экспорт/импорт всех данных одним JSON-файлом (без облака).
3. **SQLite** — `better-sqlite3` как хранилище для библиотеки и истории.

Порядок внедрения: Х-1 (слой данных SQLite) → Х-2 (сервис библиотеки) →
Х-3 (UI библиотеки) → Х-4 (бэкап).

## Х-1: Слой данных (SQLite)

### Модули

- `src/main/services/series-key.ts` — чистые функции `seriesKeyForUrl`,
  `galleryKeyForUrl`, `sourceLabelForUrl` (переносятся из `history.ts`, чтобы
  избежать циклических импортов между репозиторием и библиотекой).
- `src/main/services/db.ts` — **единственный** модуль, импортирующий
  `better-sqlite3`. Открывает `userData/library.db` (`journal_mode = WAL`),
  создаёт схему и выполняет миграцию по `PRAGMA user_version`.
- `src/main/services/series-repository.ts` — интерфейс `SeriesRepository` и
  реализация `SqliteSeriesRepository`.
- `HistoryManager` (`history.ts`) становится тонкой обёрткой над
  `SeriesRepository`; публичный API (`load`/`addOrUpdate`/`updateProgress`/
  `toVec`) сохраняется, поэтому `src/main/index.ts` почти не меняется.

### Схема

Одна таблица `series` (история = все строки, библиотека = `status IS NOT NULL`):

```
key            TEXT PRIMARY KEY
url            TEXT NOT NULL
title          TEXT NOT NULL
cover_url      TEXT
source         TEXT
category       TEXT NOT NULL DEFAULT 'main'   -- 'main' | 'r34'
current_page   INTEGER NOT NULL DEFAULT 1
total_pages    INTEGER NOT NULL DEFAULT 0
chapter_label  TEXT
chapter_index  INTEGER
chapter_total  INTEGER
status         TEXT                            -- NULL | reading | planned | completed | on_hold | dropped
note           TEXT NOT NULL DEFAULT ''
rating         INTEGER                         -- NULL | 1..10
tags           TEXT NOT NULL DEFAULT '[]'      -- JSON-массив строк
opened_at      INTEGER NOT NULL                -- последнее открытие, ms
created_at     INTEGER NOT NULL
updated_at     INTEGER NOT NULL
```

Индексы: `status`, `opened_at`, `title`. Служебная таблица `meta(key, value)`
хранит `schema_version`; версия схемы дублируется в `PRAGMA user_version`.

### Миграция

При первом открытии (`user_version = 0`):

1. Создать схему.
2. Импортировать `settings.viewing_history` в `series` через существующую
   нормализацию `HistoryManager.load()` (схлопывание зеркал clearnet/onion по
   `seriesKeyForUrl`), чтобы не плодить дубли.
3. Проставить `current_page`/`total_pages` из `settings.read_progress`.
4. `user_version = 1`.

Миграция идемпотентна. `settings.read_progress` остаётся как есть (его читает
`startPageFor`); DB — источник истины для экрана Library. Запись
`viewing_history` в `settings.json` прекращается (поле сохраняется для импорта
старых бэкапов).

### Устойчивость

- Битый `library.db` → переименовать в `library.db.corrupt-<ts>` и создать заново.
- `better-sqlite3` синхронный, доступ только из main-процесса — гонок нет.

## Х-2: Сервис библиотеки

`src/main/services/library.ts` — `LibraryService` поверх `SeriesRepository`:

- `upsertFromOpen(update)` — вызывается из `openUrl`/`openFolder`; создаёт или
  обновляет строку, пишет `opened_at`, `current_page`/`total_pages`,
  `cover_url`. Если `library_auto_add` включён, строка новая и URL не начинается
  с `file:` (онлайн-источник) → `status = 'reading'`. Локальные папки
  авто-добавлением не затрагиваются.
- `setStatus(key, status | null)`, `setNote(key, text)`,
  `setRating(key, 1..10 | null)`, `setTags(key, string[])`.
- `list(query)` — фильтры `status` / `search` (по title) / `category`; сортировки
  `last_read` | `title` | `rating` | `added`.
- `get(key)`.
- `removeFromLibrary(key)` → `status = NULL` (история остаётся).
- `deleteSeries(key)` → удаление строки целиком.

Статусы: `reading`, `planned`, `completed`, `on_hold`, `dropped`.

## Х-3: UI библиотеки

- Сайдбар: новый пункт **Library** после History (`store.tsx` тип `Screen`,
  `components/Sidebar.tsx`).
- `screens/Library.tsx` — табы-фильтры по статусу со счётчиками, поиск,
  сортировка, сетка карточек с бейджем статуса и оценки. Клик по карточке
  открывает модалку.
- `components/LibraryItemModal.tsx` — обложка, источник, прогресс, выбор статуса,
  оценка, textarea заметки, редактор тегов, кнопки «Открыть» / «Убрать из
  библиотеки» / «Удалить из истории».
- Кнопка «＋ В библиотеку»: в модалке глав каталога (`Catalog.tsx`), в тулбаре
  `Reader.tsx`, на карточке истории (`HistoryCardGrid.tsx`).
- `Settings` — тумблер «Авто-добавлять в библиотеку» (`library_auto_add`, дефолт
  `true`).
- R34-строки в библиотеке уважают существующий `show_r34_history`.

## Х-4: Бэкап (экспорт/импорт, без облака)

`src/main/services/backup.ts`:

- `buildBackup(includeSecrets): BackupFile`.
- `applyBackup(text): BackupSummary`.

Формат:

```json
{
  "format": "manga-reader-backup",
  "version": 1,
  "exportedAt": 0,
  "settings": { },
  "series": [],
  "accounts": [],
  "downloads": []
}
```

- По умолчанию **без секретов**: куки (`onion_cookies_raw`,
  `nhentai_cookies_raw`, `nhentai_onion_cookies_raw`, `senkuro_cookies_raw`),
  прокси-адреса (`exhentai_proxy_addr`, `mangalib_proxy_addr`) и `tor_bridges`
  вычищаются; `accounts` не включается. PIN не экспортируется никогда. Галочка
  «включить секреты» добавляет их.
- Экспорт: `dialog.showSaveDialog`, имя по умолчанию
  `manga-reader-backup-YYYYMMDD.json`.
- Импорт: `dialog.showOpenDialog` → валидация `format`/`version` → копия текущей
  БД в `library.db.bak` → **merge**:
  - `series` — по ключу, побеждает свежий `updated_at`; отсутствующие вставляются;
  - `settings` — применяются; пустые секретные поля не затирают текущие;
  - `accounts` — добавляются с дедупом по `ipbMemberId`;
  - `downloads` — мержатся по `sourceUrl` (текущее состояние сохраняется).
- Результат: `BackupSummary { seriesAdded, seriesUpdated, accountsAdded,
  downloadsMerged }`.
- UI: секция «Резервная копия» в Settings — Экспорт / Импорт / галочка
  «включить секреты» / текст результата.

## IPC / типы

- `src/shared/library.ts`: `ReadingStatus`, `LibraryItem`, `LibraryQuery`,
  `BackupSummary`, `BackupFile`.
- `src/shared/ipc.ts` (каналы + `Api`):
  - `libraryList`, `libraryGet`, `librarySetStatus`, `librarySetNote`,
    `librarySetRating`, `librarySetTags`, `libraryRemove`, `libraryDelete`;
  - `backupExport`, `backupImport`;
  - событие `libraryChanged`.
- `src/preload/index.ts` — проброс новых методов и события.
- `src/shared/settings.ts`: `library_auto_add: boolean` (default `true`).

## Сборка

- deps: `better-sqlite3`; devDep `@types/better-sqlite3`.
- `package.json`: `"postinstall": "electron-builder install-app-deps"` —
  пересборка нативного модуля под ABI Electron.
- `electron-builder.yml`: `asarUnpack: ['**/node_modules/better-sqlite3/**']`.

## Тесты

- `LibraryService` (статусы, теги, выборки, upsert-авто-добавление) — против
  `InMemorySeriesRepository`; нативный модуль не грузится (обход конфликта ABI
  Node/Electron).
- `series-key` — чистые тесты ключей по источникам.
- merge-логика `applyBackup` — чистые тесты (без БД).
- Реальный SQLite — dev-smoke скриптом под Electron (не в vitest).
- После каждого шага: `npm run typecheck && npm test`.

## Риски

- Конфликт ABI Node/Electron — снят repository-паттерном (тесты не импортируют
  `better-sqlite3`).
- Идемпотентность миграции — по `user_version`.
- Строка, которая и в истории, и в библиотеке, — это одна строка; удаление
  истории удаляет и запись библиотеки (в UI подтверждение).
- Авто-добавление локальных папок отключено (только онлайн).
