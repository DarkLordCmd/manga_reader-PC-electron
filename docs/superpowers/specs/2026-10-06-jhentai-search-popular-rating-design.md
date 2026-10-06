# Быстрый поиск, Популярное и Рейтинг (из JHenTai) — Design Spec

Дата: 2026-10-06
Статус: approved

Три фичи по образцу JHenTai: (1) **пресеты быстрого поиска** (именованные
сохранённые поиски), (2) отдельный экран **«Популярное»** (ранклист E-Hentai/
ExHentai `/popular`), (3) **минимальный рейтинг** в поиске E-Hentai/ExHentai
(`f_srdd`) + показ рейтинга.

## Ф-1: Пресеты быстрого поиска

- `Settings.quick_searches: QuickSearch[]`; `QuickSearch = { id: string; name: string; source: string; query: string }`.
- Хранение — `settings.json` (как `eh_tag_bookmarks`), не SQLite.
- Чистые функции (`src/shared/quick-search.ts`): `addQuickSearch(list, entry)`,
  `removeQuickSearch(list, id)`, `moveQuickSearch(list, id, dir)`,
  `normalizeQuickSearches(raw)` (валидация при парсинге настроек).
- UI: в тулбаре каталога кнопка **«Быстрые поиски»** → выпадающий список:
  - клик по пресету — устанавливает `source` + `query` и запускает поиск;
  - **«＋ Сохранить текущий поиск»** — `window.prompt` имени, сохраняет текущие `source`+`query`;
  - у пункта: удалить (✕) и переместить вверх/вниз (порядок).

## Ф-2: Экран «Популярное»

- Новый пункт сайдбара **«Популярное»** (иконка 🔥), `Screen` + `App` рендер.
- `screens/Popular.tsx`: переключатель аккаунта/домена **E-Hentai / ExHentai / ExHentai (onion)**,
  сетка карточек (обложка, название, рейтинг), клик открывает галерею, бесконечная прокрутка не требуется
  (v1 — первая страница ранклиста).
- Main `src/main/services/sources/eh.ts`: `fetchEhPopular(source, opts)` — GET
  `https://e-hentai.org/popular` / `https://exhentai.org/popular` / onion-база, те же UA/Referer/
  Cookie/proxy, что у `searchExHentai`; парсинг через существующий `parseExHentaiListing`
  (страница `/popular` использует ту же разметку `.itg`) + `assertLayout`; обогащение рейтинга
  через `fetchGData` (best-effort).
- IPC `catalog:popular` → `Api.catalogPopular(source)` → `CatalogCard[]` (с `score`).

## Ф-3: Минимальный рейтинг в EH-поиске

- `CatalogFilters.ehMinRating?: number` (0 = без фильтра, 2/3/4/5).
- `searchExHentai` принимает `minRating?: number` и добавляет `f_srdd=<n>` в query.
- В панели фильтров E-Hentai/ExHentai (`Catalog.tsx`) — селект
  «Мин. рейтинг: любой / 2+ / 3+ / 4+ / 5»; прокидывается через `filters.ehMinRating`.
- Рейтинг отображается на карточках (уже) и в «Популярном».

## IPC / типы

- `CH.catalogPopular = 'catalog:popular'`; `Api.catalogPopular(source: string): Promise<CatalogCard[]>`.
- `CatalogFilters.ehMinRating?: number`.
- `Settings.quick_searches: QuickSearch[]` (+ default `[]`, + `parseSettings`).

## Тесты

- `quick-search`: add/remove/move/normalize (чистые).
- `eh.ts`: `buildEhSearchParams({...})` включает `f_srdd` при `minRating` (вынести чистую
  функцию сборки параметров) — тест.
- `fetchEhPopular`: парсер `parseExHentaiListing` на фикстуре страницы `/popular` (тот же парсер,
  отдельный фикстур-кейс с разметкой популярного списка).
- Живой `/popular` — dev-smoke.

## Вне рамок (YAGNI)

- Личная оценка произведений (уже есть в Библиотеке).
- Категории/периоды ранклиста EH (v1 — общий популярный список).
- Импорт чужих конфигов JHenTai.
- Синхронизация пресетов через Google Drive (v1 — локально в settings.json).
