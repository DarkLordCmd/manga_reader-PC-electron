# 6 фич из разбора MangaNet — Design Spec

Дата: 2026-09-13
Статус: approved

Порядок внедрения: Ф-4 (рефактор) → Ф-1 (browser-канал) → Ф-2 (Grouple) → Ф-5 (MangaMello) → Ф-3 (зеркала) → Ф-6 (watchdog).

## Ф-4: Разделение catalog-search.ts

- Новый каталог `src/main/services/sources/`:
  - `catalog-types.ts` — CatalogItem/CatalogFilters/source keys/SimpleSiteConfig
  - `simple-sites.ts` — searchSimpleSite (Com-X/Mangalib)
  - `eh.ts` — ehErrorFromResponse, parseExHentaiListing, GData, searchExHentai
  - `remanga.ts` — searchRemanga + chapter-функции из sources.ts
  - `senkuro.ts` — searchSenkuro + GraphQL-главы из sources.ts
  - `mangashi.ts` — searchMangaShi + fetchMangaShiChapters
  - `nhentai.ts` — searchNhentai
  - `mangamello.ts` — (новое, Ф-5)
  - `grouple.ts` — (новое, Ф-2)
- `catalog-search.ts` → re-export фасад (обратная совместимость импортов в index.ts
  и тестах). Старый `sources.ts` удаляется после переноса (его импорты в index.ts
  переключаются на новые файлы).
- Тесты каталога перееэкспортируются с кодом (tests/catalog-search.test.ts остаётся
  рабочим через фасад).

## Ф-1: Hidden BrowserWindow-канал (src/main/services/browser-fetch.ts)

- `fetchHtmlViaBrowser(url, { proxy?, timeoutMs? }): Promise<string>`:
  скрытое BrowserWindow (show:false, 1024x768), `session.setProxy` при прокси,
  блокировка медиа/шрифтов через `webRequest.onBeforeRequest` (оставить только
  document/stylesheet), preload-скрипт со stealth (удаление navigator.webdriver,
  спуф permissions.query и Function.prototype.toString — как MangaNet),
  навигация через loadURL, `did-finish-load` + 2с покоя,
  `executeJavaScript('document.documentElement.outerHTML')`.
- Одно переиспользуемое скрытое окно; принудительное destroy по таймауту (30с)
  и на app quit.
- Анти-детект gate: единый checkpoint для HTML-фетчей — HTTP-first через httpFetch;
  при детекте анти-бота (403/429/503, маркеры 'Just a moment' / 'Checking your
  browser' / 'Cf-Mitigated: challenge', пустая вёрстка после парсинга, SNI-таймаут)
  → fallback в браузер и парс того же HTML.
- Первичное применение: Grouple (Ф-2) + Com-X и Manga-shi (существующие).
- Ошибки навигации/таймаута → русское сообщение «Не удалось загрузить страницу через
  встроенный браузер: …».

## Ф-2: Grouple (Readmanga / Mintmanga / Mangapoisk)

- `sources/grouple.ts`: три конфига сайтов (readmanga.me, mintmanga.com,
  mangapoisk.me): каталог — HTML-лист с ссылками `/manga/<slug>` + обложки; поиск
  по `?search=<q>`. Главы и страницы — через resolveGallery → fetchSimpleGallery,
  где сам фетч страницы идёт через HTTP-first/browser-fallback gate (Ф-1).
- Source keys в каталоге: 'readmanga' | 'mintmanga' | 'mangapoisk'.

## Ф-3: Зеркала Lib-семейства (mangalib/yaoilib/slashlib/hentailib)

- Settings: `lib_image_server: string | null` (null = дефолт сайта).
- Известные зеркала (клиентская константа): img33/img34/img45.imgslib.link.
- IPC `libMirrors:check` — HEAD-пинг каждого зеркала с таймингами; кнопка
  «Проверить зеркала» в Settings; лучший (или выбранный вручную) применяется.
- Переписывание хоста у картинок на отдаче, если хост ≡ *.imgslib.link и выбрано
  не-дефолтное зеркало.

## Ф-5: MangaMello

- sources/mangamello.ts: REST `https://api.mangamello.com/v1/mangas/`; каталог —
  `?search=<q>` (JSON-список), чтение главы — JSON с массивом ссылок на изображения.
- Source key 'mangamello' в каталоге.

## Ф-6: Layout-watchdog (src/main/services/layout-watcher.ts)

- `assertLayout(markers: string[], html: string, sourceName: string): void` —
  при отсутствия всех маркеров бросить ошибку:
  `{ code: 'layout-changed', pageHash: <первые 8 hex sha256(html)>, sourceName,
  htmlHead: <первые 300 символов html> }` + русское сообщение:
  «Парсер <sourceName> сломался: сайт поменял вёрстку (page hash <sha8>).
  Пришли разработчику этот хеш.»
- Подключение во все HTML-парсеры (simple-sites, mangashi, grouple, nhentai,
  EH-листинг).

## IPC

- Новый канал: `libMirrors:check`.
- Каталог/чтение Grouple/MangaMello — через существующий `catalog:search` / `url:open`
  с новыми source keys.

## Тесты (vitest)

- grouple HTML-парсеры (фикстуры листа+глав), mangamello JSON-парсер,
  layout-watcher (позитив/негатив), рерайт зеркал (чистые URL-функции).
- browser-fetch — ручной smoke (сеть).
