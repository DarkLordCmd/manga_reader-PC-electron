# Избранное + контекстное меню статусов в каталоге — Design Spec

Дата: 2026-10-05
Статус: approved

Фича: (1) отдельный раздел **«Избранное»** — простой список произведений,
независимый от статусов чтения; (2) **контекстное меню по правому клику** на
карточке каталога: добавить/убрать из избранного и выбрать статус
(Читаю / В планах / Прочитано / Отложено / Брошено).

## Требования (утверждено)

- «Избранное» и «Library» (статусы) — **независимые**: строка может иметь
  `favoritedAt` и/или `status`, или ни то ни другое.
- Контекстное меню — **кастомное HTML** в рендерере (тёмная тема), состояние
  (favorited/status) подтягивается через `libraryLookup` при открытии.
- Меню доступно на карточках каталога и на карточках экрана «Избранное».
- Синхронизируется: `favoritedAt` — часть `LibraryItem`, едет в sync-payload.

## Ф-1: Данные и хранилище

- `series` + колонка `favorited_at INTEGER` (nullable). Миграция
  `PRAGMA user_version` 2→3: `ALTER TABLE series ADD COLUMN favorited_at INTEGER`
  (идемпотентно; helper `needsFavoritedAtColumn(userVersion, columns)`).
- `LibraryItem.favoritedAt: number | null`; `SeriesUpsert.favoritedAt?: number | null`.
- `SeriesRepository.setFavorite(key: string, at: number | null): void`
  (оба репозитория). `upsertHistory` не трогает `favorited_at`; insert — `NULL`;
  `importItems` переносит `favorited_at`.
- `LibraryQuery.scope?: 'library' | 'favorites'` (default `'library'`).
  `BaseSeriesRepository.list`: `favorites` → фильтр `favoritedAt !== null`;
  иначе → `status !== null`. Поиск/сортировка/r34 — как есть.
- `db.ts` SCHEMA + migrate v3.

## Ф-2: Сервис (`LibraryService`)

- `setFavorite(key, on: boolean): void` → `repo.setFavorite(key, on ? Date.now() : null)`.
- `addFavorite(entry: CatalogAddEntry): LibraryItem` — upsert строки (как
  `addFromCatalog`), затем `setFavorite(key, Date.now())`; статус не трогает.
- `lookup(url, seriesId): { favorited: boolean; status: ReadingStatus | null } | null`.
- `countFavorites(): number`; список — `repo.list({ ...query, scope: 'favorites' })`.

## Ф-3: IPC / preload / типы

- Каналы: `librarySetFavorite(key, on)`, `libraryAddFavorite(entry)`,
  `libraryLookup(url, seriesId)`; `LibraryQuery.scope`.
- `window.api.librarySetFavorite/libraryAddFavorite/libraryLookup`.

## Ф-4: UI

- `components/ContextMenu.tsx` — кастомное меню: позиция по курсору с клампингом
  в окно; закрытие по клику вне и Esc; пункты `{ label, onClick, checked?, danger?, separator? }`.
- `MangaCardGrid.tsx` + `onContextMenu?(e, card)`; `Catalog.tsx` открывает меню:
  «★ В избранное / Убрать из избранного»; группа «Статус:» (5 пунктов с ✓ у
  текущего); «Убрать из библиотеки».
- `screens/Favorites.tsx` — сетка избранного (без табов), клик открывает,
  правый клик → то же меню.
- `Sidebar.tsx` + пункт **Favorites** (♥), `store.tsx` Screen `'Favorites'`,
  `App.tsx` рендер.

## Вне рамок (YAGNI)

- Добавление в избранное со экранов Reader/History.
- Папки/теги/категории избранного.
- Нативное меню Electron.
- Отдельная таблица избранного (используем колонку `favorited_at`).
- Известное поведение: строки, созданные добавлением из каталога (в т.ч.
  в избранное), видны во «Истории» как строки без прогресса (унаследовано от
  текущей модели `series`).

## Тесты

- Репозиторий: `setFavorite` + `list({scope:'favorites'})` фильтрует только
  избранное; `scope:'library'` не показывает избранное без статуса; миграция v3.
- `LibraryService.addFavorite/setFavorite/lookup`.
- sync-payload: `favoritedAt` переносится при merge.
- UI — ручной smoke.
