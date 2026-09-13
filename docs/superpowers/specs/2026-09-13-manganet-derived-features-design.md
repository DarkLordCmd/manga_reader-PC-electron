# 6 фич из разбора MangaNet — Design Spec

Дата: 2026-09-13
Статус: approved

Порядокفيذ: Ф-4 (рефактор) → Ф-1 (browser-канал) → Ф-2 (Grouple) → Ф-5 (MangaMello) → Ф-3 (зеркала) → Ф-6 (watchdog).

## Ф-4: Разделение catalog-search.ts

- Файл-структура: каталог `src/main/services/sources/` как в дизайне в чате:
  `catalog-types.ts` (CatalogItem/Filters/source keys), `simple-sites.ts`, `eh.ts`,
  `remanga.ts` (+ chapter-функции из sources.ts), `senkuro.ts` (+ GraphQL-главы),
  `mangashi.ts` (+ fetchMangaShiChapters), `nhentai.ts`, впоследствии `mangafox.ts`,
  `grouple.ts`, `mirror tool`.
  `catalog-search.ts` → re-export фасад (обратная совместимость), `sources.ts` → удалить
  после переноса. Тесты каталога двигаются с кодом.

## Ф-1: Hidden BrowserWindow-канал (`src/main/services/browser-fetch.ts`)

- `fetchHtmlViaBrowser(url, { proxy?, timeoutMs? }): Promise<string>`:
  hidden BrowserWindow (show:false, 1024x768), `session.setProxy`, блокировка
  медиа/шрифтов через `webRequest.onBeforeRequest` (оставить document/stylesheet),
  preload-скрипт со stealth (удаление navigator.webdriver, спуф
  permissions.query/Function.toString — как MangaNet), навигация через loadURL,
  `did-finish-load` + 2с сетевой покой, `executeJavaScript('document.documentElement.outerHTML')`.
- Реиспользование одного скрытого окна; destroy при таймауте (30с) и на quit.
- Fallback-шлюз: весь HTML-фетч источника через один checkpoint — HTTP-first через
  httpFetch; при детекте анти-бота (403/429/503 + 'Just a moment'/'Checking your
  browser'/'Cf-Mitigated' + пустая вёрстка + SNI-таймаут) → fallback в браузер и
  парс того же HTML. Активируется для Grouple + Com-X + Manga-shi.
- Ошибки навигации/таймаута → единое русское сообщение «Не удалось загрузить страницу
  через встроенный браузер: …».

## Ф-2: Grouple (Readmanga/mintmanga/mangapoisk)

- `sources/grouple.ts`: три конфига site (readmanga.me, mintmanga.com, mangapoisk.me):
  каталог (HTML-лист /manga/ + обложки), поиск по `?search=q`; обсуждент: главы по
  этим же URL через HTTP-first/browser-fallback; страницы: `fetchSimpleGallery`
  общей веткой (после Ф-4/gallery-resolve-расширения).
- Регистрация в каталоге UI: source keys 'readmanga' | 'mintmanga' | 'mangapoisk'.

## Ф-3: Зеркала Lib-семейства

- Settings: `lib_image_server: string | null`.
- Известные зеркала (client const): img33/img34/img45.imgslib.link.
- IPC `libMirrors:check` → пинг каждого + лучший/тайминги; кнопка в Settings.
- Рерайт URL страниц при отдаче картинок, если хост ≡ imgslib.link и выбран ≠ дефоулт.

## Ф-5: MangaMello

- sources/mangafox.ts: REST `https://api.mangamello.com/v1/mangas/`, каталог
  `?search=…`, чтение главы из JSON (images-поле).
- source key 'mangafox' (mangamello) в каталоге.

## Ф-6: Layout-watchdog (`src/main/services/layout-watcher.ts`)

- `assertLayout(markers: string[], html: string, sourceName: string): void` — если
  ни один маркер не найден: бросить ошибку с формой как в спеке (структурированные
  поля code='layout-changed', sha256-8, sourceName, htmlHead 300) + русское
  сообщение для UI.
- Подключение во все HTML-парсеры (simple-sites, mangashi, grouple, nhentai, EH).

## IPC

Новые каналы: `libMirrors:check`. Каталог: расширенные source keys через существующий
`catalog:search`.

## Тесты (vitest)

- grouple HTML-парсеры (фикстуры лист/главы), mangafox JSON-парсер,
  layout-watcher, rewrite-зеркал.
- Рingerprint для browser-fetch — ручной smoke (сеть).
