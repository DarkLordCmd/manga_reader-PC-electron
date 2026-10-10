# Manga Reader (Electron)

Читалка манги/комиксов для Windows (Linux/macOS собираются, но проверяются на Windows), портированная на Electron.

- Каталог и поиск по десяткам источников: MangaDex, E-Hentai/ExHentai (в т.ч. onion), NHentai (в т.ч. onion), Com-X, Senkuro, Manga-shi, Remanga, mangalib, Readmanga/Mintmanga/Mangapoisk, MangaMello.
- Встроенный Tor (эксперт-бандл) с мостами, socks5, domain fronting, кастомные DNS.
- Локальные галереи: папки и `.zip`/`.cbz` архивы; скачивание галерей и EH-архивов.
- Библиотека, избранное, история, прогресс чтения, статусы, заметки, теги, оценки.
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

- Tor-бандл (`vendor/tor`, только Windows) скачивает `scripts/fetch-tor.mjs`
  напрямую с официальных зеркал torproject.org и **проверяет sha256 по
  `sha256sums-signed-build.txt`** перед распаковкой. Пропускается, если
  `vendor/tor` уже содержит актуальную версию.
- Артефакты: `dist/Manga Reader Setup 0.1.0.exe` (установщик NSIS),
  `dist/Manga Reader 0.1.0.exe` (portable), `dist/win-unpacked/`.

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

## Tor / fronting

- Встроенный Tor включается в настройках (Built-in Tor); onion-источники
  (ExHentai onion, NHentai onion) ходят через него автоматически.
- Мосты задаются в настройках; `scripts/fetch-tor.mjs` использует
  socks5 `127.0.0.1:9150` (Tor Browser) как fallback-транспорт для скачивания.
- Domain fronting для обхода блокировок — toggle в настройках (Network).

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

`npm test` (~290 unit-тестов, чистый Node): парсеры источников, галереи/zip,
репозиторий SQLite, шифрование секретов (safeStorage/secret-box), PIN (scrypt),
валидация IPC (zod), математика читалки. Electron в тестах заменяется стабом
(`tests/electron-mock.ts` через alias в `vitest.config.ts`); zip-фикстуры
генерируются в Node (без PowerShell) — прогон кросс-платформенный.

## Лицензия

MIT.
