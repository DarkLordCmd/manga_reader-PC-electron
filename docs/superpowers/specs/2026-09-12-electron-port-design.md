# Manga Reader → Electron Port — Design Spec

Дата: 2026-09-12
Статус: approved

## Контекст

Текущее приложение `E:\manga_reader` — десктоп-ридер манги на Rust (eframe/egui,
reqwest, scraper, ~10 000 строк). Поддерживает локальные папки, онлайн-источники
(MangaDex, ExHentai обычный/onion, E-Hentai, NHentai обычный/onion, Com-X,
Senkuro, Manga-shi, Remanga, Mangalib), Tor/SOCKS5, куки-логин, каталог, историю
просмотра и настройки.

Задача: полный перенос всех функций на Electron (React + TS + Vite), чистый
TypeScript без Rust, кросс-платформенная сборка, миграция существующих данных
пользователя.

## Архитектура

Новый проект в отдельной папке `E:\manga_reader-electron`. Rust-код остаётся
нетронутым как референс.

Три процесса:

- **main-процесс (Node/TS)** — вся сетевая логика: скачивание глав, HTML-парсеры
  (cheerio), Tor/SOCKS5 (`socks-proxy-agent`), куки, локальный ридер, история,
  настройки, веб-логин (BrowserWindow).
- **renderer (React)** — только UI: ридер (scroll/book), каталог, история,
  настройки. Данные через типизированный IPC-мост.
- **preload** — `contextBridge` → `window.api`.

Структура:

```
E:\manga_reader-electron\
├─ package.json / electron-builder.yaml / tsconfig / vite.config
├─ electron\
│  ├─ main.ts           # окна, lifecycle, IPC-регистрация
│  ├─ preload.ts        # contextBridge → window.api
│  ├─ ipc.ts            # типизированные каналы
│  └─ services\
│     ├─ settings.ts    # тот же формат settings.json
│     ├─ history.ts     # HistoryEntry/HistoryUpdate + логика add_or_update
│     ├─ gallery.ts     # аналог loader.rs: Page/Gallery, лимиты, префетч, эвикция, рескан
│     ├─ cookies.ts     # CookieJar, parse_cookie_lines, Tampermonkey, nw=1, igneous
│     ├─ tor.ts         # SOCKS5-клиент, проверка Tor/мостов/доступности сайтов
│     ├─ login.ts       # веб-логин (BrowserWindow) для onion-сайтов
│     └─ sources\       # парсеры/клиенты: mangadex, exhentai, ehentai, nhentai,
│                       #   comx, senkuro, mangashi, remanga, mangalib
├─ shared\              # типы, константы, схема Settings (main/preload/renderer)
├─ src\                 # React renderer
│  ├─ screens\   Reader.tsx Catalog.tsx History.tsx Settings.tsx
│  ├─ components\ Sidebar.tsx TopBar.tsx ThumbnailPanel.tsx ChapterList.tsx CardGrid.tsx ...
│  ├─ hooks\     useGallery.ts useCatalog.ts ...
│  └─ App.tsx
└─ tests\               # vitest: парсеры (HTML-фикстуры), история, SOCKS5-handshake
```

Ключевые решения:

- Сеть целиком в main через `fetch`/`undici` + `socks-proxy-agent` для Tor.
  Renderer не видит сеть.
- Изображения через кастомный протокол `manga://page/<galleryId>/<index>` — main
  отдаёт картинку по мере загрузки. Аналог текстур egui: кэш в памяти, эвикция
  далёких страниц.
- Обложки через `manga://cover/<galleryId|url>` с per-site Referer/Tor.
- Настройки и история — тот же JSON-формат, миграция при первом запуске.
- Веб-логин — отдельное BrowserWindow с прокси через Tor; куки забираются через
  `session.cookies` (надёжнее `document.cookie`).

## Поток данных и IPC

- **Команды** (renderer → main, `ipcRenderer.invoke`): `openUrl`, `openFolder`,
  `openChapter`, `setSettings`, `searchCatalog`, `loginSite`, `jumpToPage`.
- **События** (main → renderer, `webContents.send`): прогресс загрузки, статус
  Tor, результаты поиска, обложки, ошибки.
- **Галерея**: открытие создаёт Gallery в main, возвращает метаданные (title,
  page count). Renderer шлёт `setReadingPosition(index)` — main делает префетч
  вперёд/назад и эвикцию.
- **История**: main хранит и пишет; renderer шлёт `recordProgress(url, page,
  total)`. Нет гонок за диск.

## Ридер

- Режимы: Scroll (лента с width_scale) и Book (1–2 страницы, LTR/RTL,
  клик-зоны по третям экрана; горячие клавиши ←/→/↑/↓, WASD, T, M, ?).
- Scroll: виртуализация через IntersectionObserver; текущая страница — та, что
  у верхнего края вьюпорта. Прыжок через `scrollIntoView` реального DOM.
- Book: клик-зоны 33% влево/вправо, `pages_per_screen` 1–2, RTL меняет порядок.
- Прелоад/эвикция: main знает позицию (`setReadingPosition`) и решает, что
  грузить/выкидывать (контракт `Gallery::request_load`).
- Тумбнейл-панель: своя полоса прокрутки, следует за текущей страницей, клик
  прыгает.
- Главы: список, ✓ для прочитанных, авто-переход на следующую главу на
  последней странице.
- Page counter `Pg 3/240` + jump-to-page; ошибки страницы с Retry (включая
  renewal URL для ExHentai).

## Каталог

Порт CatalogState, 11 источников. Поиск и сетка карточек с обложками
(`manga://cover`), типом, рейтингом, кол-вом глав. Сортировки MangaDex
(релевантность/рейтинг/последние/подписки). Пагинация и `infinite_scroll`.

- Per-site Tor-переключатели для «простых» сайтов (opt-in, ключ в settings.json).
  ExHentai-onion всегда через Tor; ExHentai-обычный — через `exhentai_proxy_addr`.
- Куки: ручная вставка (JSON/name=value/curl), Tampermonkey-экспорт, автологин
  из `.storage.json`, `nw=1`, кросс-референс igneous из Share-пула.
- Веб-логин через BrowserWindow для onion-сайтов.
- Сетевые проверки: Tor SOCKS-адрес + «Проверить Tor» (SOCKS5 handshake +
  latency), мосты + «Проверить мосты» (TCP-проба), «Доступность сайтов».
- Автодополнение тегов EH/NHentai + избранные теги.
- Главы: список для серии, продолжение чтения.

## История

Порт history.rs: одна карточка на серию (dedup по series_id), вкладки
Main/R34, прогресс-бары (глава + серия), «Продолжить/Открыть», защита от
перезаписи при случайном открытии ранней главы, обложки с per-site Referer/Tor,
кнопка очистки.

## Настройки

Тот же settings.json, все поля:

`reading_mode, book_direction, width_scale, pages_per_screen, show_thumbnails,
page_margin, thumb_size, last_folder, read_progress, tor_socks_addr, tor_bridges,
exhentai_proxy_addr, onion_cookies_raw, nhentai_onion_cookies_raw,
nhentai_onion_base, infinite_scroll, tor_proxied_sites, nhentai_show_page_counts,
viewing_history, show_r34_history, eh_tag_bookmarks, read_chapters`

## Миграция данных

При первом запуске: если userData пуст и существует
`%APPDATA%\mangareader\manga_reader\settings.json` — копируем в userData без
изменений (формат идентичен). Флаг `migrated_v1` в файле против повторного
копирования. `last_folder` остаётся валидным.

## Ошибки

Единый слой форматирования в main (порт `describe_reqwest_error`,
детерминированные русские сообщения). Ошибки — структурированные
`{ code, message, retryable }` через IPC. Повторные попытки страниц
(MAX_ATTEMPTS, RETRY_DELAY, renewable URL) переносятся 1:1.

## Тесты

- vitest: парсеры (HTML-фикстуры каждого сайта), история (add_or_update,
  защита от ранней главы), SOCKS5-handshake Tor.
- Сеть — мок-сервер, без реальных сайтов.

## Упаковка

electron-builder: Windows NSIS + portable, macOS dmg, Linux AppImage/deb.
Протокол `manga://` регистрируется в main; в production изображения отдаются из
памяти/кэша. Node/Electron версии фиксируются в `engines`/`.nvmrc`.

## Порядок работы

1. Каркас + IPC + настройки/миграция.
2. Ридер (локальная папка + scroll/book).
3. MangaDex + обложки.
4. История.
5. Каталог всех источников + Tor/куки.
6. Веб-логин.
7. Упаковка и тесты.