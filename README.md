# Manga Reader (Electron)

Читалка манги/комиксов для Windows (Linux/macOS собираются, но проверяются на Windows), портированная на Electron.

- Каталог и поиск по десяткам источников: MangaDex, E-Hentai/ExHentai (в т.ч. onion), NHentai (в т.ч. onion), Com-X, Senkuro, Manga-shi, Remanga, mangalib, Readmanga/Mintmanga/Mangapoisk, MangaMello.
- **Поиск с подсказками**: у каждого источника свой автокомплит (Senkuro/Senkognito, MangaDex, Remanga, NHentai — обложки и метаданные; E-Hentai/ExHentai — теги с добавлением в поле тегов).
- **Remanga**: вход через отдельное окно remanga.org (как у Senkuro), затем импорт закладок (Читаю / В планах / Прочитано / Отложено / Брошено) с последней главой; пароль вводится только на сайте.
- **Дубли произведений**: одинаковые названия из разных источников показывают максимальный прочитанный прогресс, а в карточке можно переключить источник.
- **Senkuro и Senkognito**: каталог, фильтры, 18+ каталог через `senkognito.com`, импорт закладок со статусами, прогрессом и прочитанными главами.
- **Приватность**: опция «Размывать 18+ обложки» — каталог, библиотека, история и подсказки показывают explicit-обложки размытыми; чтение не меняется.
- **R34-правила**: explicit-работы (hentai/smut) помечаются 18+, живут в R34-разделе библиотеки и скрываются, когда «Контент R34» выключен. Возрастной `EXPLICIT` за насилие/хоррор не считается R34 и остаётся в Main.
- Встроенный Tor (эксперт-бандл) с мостами, socks5, domain fronting, кастомные DNS; **изоляция Tor-потоков**, прогрев цепей и диагностика.
- Локальные галереи: папки и `.zip`/`.cbz` архивы; скачивание галерей и EH-архивов.
- Библиотека, избранное, история, прогресс чтения, статусы, заметки, теги, оценки; **фильтр по источникам** с количеством и мультивыбором.
- Аккаунты E-Hentai (cookie/пароль, пул аккаунтов), автодетект куки из буфера.
- Синхронизация библиотеки/прогресса через Google Drive; бэкап/импорт в JSON.
- Защита: PIN (scrypt), секреты at-rest через `safeStorage`, CSP, sandbox-окна, валидация IPC (zod).

## Стек

Electron 44 · electron-vite · React 18 · TypeScript (strict) · better-sqlite3 · cheerio · zod · vitest · ESLint + Prettier.

## Разработка

```bash
npm install
npm run dev          # electron-vite dev с HMR
npm run typecheck    # tsc по main/preload/renderer
npm run test         # vitest (unit)
npm run lint         # eslint (no-explicit-any — предупреждения)
npm run format       # prettier --write .
```

## Сборка дистрибутива

```bash
npm run dist   # Windows: качает Tor-бандл → electron-vite build → electron-builder (nsis + portable)
```

- Tor-бандл (`vendor/tor`, скачивается под **текущую ОС/архитектуру** — Windows,
  Linux, macOS) получает `scripts/fetch-tor.mjs` напрямую с официальных зеркал
  torproject.org и **проверяет sha256 по `sha256sums-signed-build.txt`** перед
  распаковкой. Пропускается, если `vendor/tor` уже содержит актуальную версию.
- Артефакты: `dist/Manga Reader Setup 0.2.0.exe` (установщик NSIS),
  `dist/Manga Reader 0.2.0.exe` (portable), `dist/win-unpacked/` (Linux —
  `AppImage`/`deb`, macOS — `dmg`).

## Senkuro / Senkognito

- Обычный каталог Senkuro идёт через `api.senkuro.me`; текстовый поиск —
  через локализованный endpoint нового сайта.
- **18+ каталог живёт на Senkognito** (`senkognito.com/browse/manga`): фильтр
  18+ переключает запрос на его операцию `fetchMangas` с `App-Id`
  Senkognito. Поддерживаются поиск, сортировка, фильтры (тип, формат, статус,
  рейтинг, перевод, страна, лейблы, главы, год) и пагинация.
- **Импорт закладок** Senkuro/Senkognito: Читаю / В планах / Прочитано /
  Любимое / Отложено / Брошено, с текущей главой, страницей продолжения и
  отметками прочитанных глав (ограничение хранилища — 4000 последних).
- **18+ бейдж** на карточке — это возрастной рейтинг Senkuro EXPLICIT (включая боевики/хоррор за насилие). **R34** (скрытие/категория) — отдельный признак, только hentai/smut.
- **R34** определяется не возрастным рейтингом (Senkuro ставит `EXPLICIT`
  и боевикам/хоррорам за насилие), а метками `hentai`/`smut`/`pornographic`.
  Для старых импортов выполняется фоновый бэкфилл: работы переезжают в R34
  или возвращаются в Main, рейтинги кэшируются в `senkuro-ratings.json`.

## Tor и сеть

- Встроенный Tor включается в настройках (Built-in Tor); onion-источники
  (ExHentai onion, NHentai onion) ходят через него автоматически. Окно/бинар
  берётся из `resources/tor` (Windows-сборка проверена на CI; Linux/macOS —
  бандлы тоже загружаются скриптом, но ещё проходят ручную проверку).
- **Изоляция потоков**: SOCKS-логины `manga-eh-pages`, `manga-eh-images`,
  `manga-general`, `manga-onion` разносят листинги, CDN картинок и остальной
  трафик по разным цепям — обложки больше не стоят в очереди перед каталогом.
- **Прогрев цепей**: после старта Tor и после `NEWNYM` приложение заранее
  открывает SOCKS-соединения к ключевым хостам, чтобы первый запрос не платил
  за построение цепи.
- **Устойчивость**: таймауты по классам трафика, повтор с одним `NEWNYM` после
  двух подряд SOCKS-ошибок, логирование медленных соединений.
- **Диагностика** в настройках: bootstrap, число построенных цепей, выходы,
  количество активных мостов; предупреждение, если мост один (Tor рекомендует
  минимум два для conflux/резерва).
- **Меньше фонового трафика**: скрытый каталог больше не догружает страницы;
  листинги EH отдаются из кэша с фоновым обновлением (stale-while-revalidate);
  кэши обложек/страниц/каталога ограничены, временные распаковки ZIP чистятся.
- Domain fronting для обхода блокировок — toggle в настройках (Network).
- Опция **«Картинки EH напрямую»**: CDN `ehgt.org`/`hath.network` без Tor
  (страницы галереи и каталога остаются через Tor; CDN видит реальный IP).

## Google-синхронизация

Вход через Google OAuth (desktop). Client identifier публичный; **client secret
в код/репозиторий не зашивается** — задаётся на этапе сборки из env:

```powershell
$env:GOOGLE_CLIENT_SECRET = '<ваш секрет>'
npm run dev           # или npm run dist
```

Без env кнопка «Войти через Google» отключена, синк возвращает понятную ошибку.

> Секрет раньше был закоммичен в публичный репозиторий — **перевыпустите его** в
> Google Cloud Console (APIs & Services → Credentials → OAuth 2.0 Client IDs) и
> считайте старый скомпрометированным.

## Обновление

Приложения собирается на GitHub Releases (см. workflow `release.yml`), обновления
раздаются через `electron-updater` (провайдер `github` в `electron-builder.yml`).
Проверка обновлений выполняется только в собранном (packaged) приложении.

## Подпись кода

- Windows: без сертификата сборки не подписаны — возможны предупреждения
  SmartScreen. Чтобы убрать, укажите секреты `CSC_LINK`/`CSC_KEY_PASSWORD`
  (или `WIN_CSC_LINK`) при `electron-builder`.
- macOS: dmg без подписи блокируется Gatekeeper; нужен Dev ID-сертификат
  (`CSC_LINK`/`CSC_KEY_PASSWORD`) перед публичным распространением.
- Иконка приложения по умолчанию — стандартная Electron. Для своей положите
  `build/icon.ico` (Windows) и `build/icon.icns` (macOS); путь задан в
  `electron-builder.yml` (`buildResources: build`).

## CI и качество

`.github/workflows/ci.yml` прогоняет lint + typecheck + тесты на ubuntu.
`.github/workflows/release.yml` собирает Windows/Linux на push тега `v*` и
публикует в GitHub Releases (для автообновления).

## Тесты

`npm test` (~523 unit-теста, чистый Node): парсеры источников (включая
Senkognito 18+ и R34-метки), галереи/zip, репозиторий SQLite, кэши
(SWR/каталог/листинги), Tor-конфигурация и изоляция, шифрование секретов
(safeStorage/secret-box), PIN (scrypt), валидация IPC (zod), математика
читалки. Electron в тестах заменяется стабом (`tests/electron-mock.ts` через
alias в `vitest.config.ts`); zip-фикстуры генерируются в Node (без PowerShell) —
прогон кросс-платформенный.

## Лицензия

MIT.
