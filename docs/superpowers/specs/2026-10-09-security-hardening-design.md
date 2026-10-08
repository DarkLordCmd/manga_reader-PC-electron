# Закалка безопасности Electron-приложения — Design Spec

Дата: 2026-10-09
Статус: approved
Область: только блок «🔴 Безопасность» из ревью. Без апгрейда Electron, без
разбиения `index.ts`, без ESLint/Prettier/логирования, без рефакторинга экранов,
без общей починки тестовой инфраструктуры.

## Контекст

Аудит выявил набор проблем безопасности. Факты, подтверждённые в коде:

- `src/main/services/google-config.ts:5` — `GOOGLE_CLIENT_SECRET` захардкожен в
  публичном репозитории.
- `src/main/index.ts:215` — у главного окна `webPreferences` содержит только `preload`.
- `src/main/services/browser-fetch.ts:85` — `contextIsolation: false` в окне, которое
  грузит произвольные сторонние сайты.
- `src/main/services/pin.ts:8` — PIN хешируется одним проходом SHA-256.
- `src/main/services/accounts.ts` и `src/main/services/settings.ts` — куки E-Hentai
  (`ipb_pass_hash`, `igneous`, `*_cookies_raw`) лежат на диске открытым текстом.
- `src/main/index.ts:698` — `openFolder(path)` принимает любой путь из renderer.
- CSP отсутствует (`src/renderer/index.html` без мета-политики).

Цель: закрыть эти векторы с минимальным риском для существующего UX и данных.
Токены Google уже используют `safeStorage` — распространяем тот же подход на
остальные секреты.

## Разбиение на рабочие ветки

Реализация делится на два независимо проверяемых и откатываемых набора:

- **WS-A «Процессы и граница IPC»** — закалка окон, CSP, permission-handlers,
  zod-валидация опасных хендлеров. Меняет рантайм-поведение, не трогает форматы данных.
- **WS-B «Секреты на диске и конфиг»** — PIN через scrypt (+миграция), `safeStorage`
  для EH-куки/аккаунтов, Google-секрет из env. Меняет on-disk формат → изолированная
  миграция и отдельный откат.

Причина разделения: смешивание миграции форматов с защитой окон ухудшает ревью и
делает гранулярный откат невозможным (особенно при неожиданном поведении миграции
секретов на Linux без keyring).

---

## WS-A. Процессы и граница IPC

### A1. Главное окно (`src/main/index.ts`, `createWindow`)

- Явные опции: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  `webSecurity: true`, `allowRunningInsecureContent: false`.
- `setWindowOpenHandler(() => ({ action: 'deny' }))` — главное окно не должно
  открывать новые окна.
- `will-navigate`: разрешена навигация только в пределах origin приложения
  (dev — origin `ELECTRON_RENDERER_URL`; prod — `file://` каталог рендерера) плюс
  same-document/hash. Иначе `event.preventDefault()`. Внешние ссылки (если появятся)
  должны идти через `shell.openExternal`.
- `will-attach-webview` → `preventDefault()` (defense in depth).

### A2. CSP (main-process, `onHeadersReceived`)

CSP задаётся заголовком ответа, а не мета-тегом в `index.html`: мета не позволяет
развести dev/prod, а заголовок надёжнее покрывает все ресурсы документа.

- В `app.whenReady()` на `session.defaultSession.webRequest.onHeadersReceived`,
  **только при `details.resourceType === 'mainFrame'`** — чтобы не переписывать
  ответы `manga://` и изображений.
- **prod:**
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' manga: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
- **dev** (`process.env.ELECTRON_RENDERER_URL` задан): тот же + `'unsafe-inline'`
  `'unsafe-eval'` в `script-src`, `connect-src 'self' ws://localhost:* http://localhost:*`
  (HMR Vite).
- CSP применяется только к `defaultSession`; сессии логина/браузер-фетча сторонних
  сайтов CSP не получают.

### A3. Окно browser-fetch (`src/main/services/browser-fetch.ts`)

- Добавить явные `nodeIntegration: false`, `sandbox: true` (оставляя
  `contextIsolation: false` — нужно stealth-скрипту).
- `setWindowOpenHandler(() => ({ action: 'deny' }))`.
- В `prepareSession()`: `setPermissionRequestHandler(() => cb(false))` и
  `setPermissionCheckHandler(() => false)`.
- `will-navigate`: разрешены только схемы `http:`/`https:` (скрейпер ходит на
  произвольные origin, но не на `file:`/`data:`/`javascript:`).

### A4. Окна логина и Google OAuth

- `src/main/services/login.ts`: добавить `sandbox: true`; на его partition-session —
  permission deny; `setWindowOpenHandler` оставить `allow` (OAuth-popup), но
  ограничить схему `http(s)`; `will-navigate` — только `http(s)`.
- `src/main/services/google-auth.ts` (`captureCode`): окно получает явные
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`;
  `setWindowOpenHandler` → deny; permission deny; `will-navigate` — только
  `accounts.google.com` и loopback `127.0.0.1`.

### A5. zod-валидация опасных IPC-хендлеров

Добавляется зависимость `zod`. Новый `src/main/ipc/validate.ts` с обёрткой, которая
парсит аргументы схемой до вызова обработчика (невалидный аргумент — отклонение с
понятной ошибкой, обработчик не вызывается).

Покрываются только хендлеры, работающие с ФС/сетью по вводу из renderer:

- `openFolder`, `rescanFolder` — аргумент: строка, непустая, без символа NUL,
  абсолютный путь, существует; это каталог либо файл `.zip`/`.cbz`. Любая
  существующая папка разрешена (как сейчас); запрещены несуществующие пути,
  не-папки/не-архивы, относительные пути.
- `openUrl`, `downloadsAdd`, `downloadsAddArchive` (`sourceUrl`, `downloadUrl`),
  `ehArchiveCost`, `ehArchiveBuy` — строки, `new URL()` парсится, схема только
  `http:`/`https:` (никаких `file:`, `data:`, `javascript:`). `dltype` — короткий
  токен `^[A-Za-z0-9_-]{1,32}$` (значения приходят от EH-страницы archiver как
  `org`/`resample`/…, поэтому фиксированный enum не подходит).
- In-memory хендлеры (`library*`, `history`, `pin*`, `getSettings`/`setSettings`)
  не трогаем — они не выходят за пределы процесса, аргументы уже под TS-типами.

Вне рамок валидации: централизованное покрытие всех 74 хендлеров.

---

## WS-B. Секреты на диске и конфиг

### B1. PIN → scrypt (`src/main/services/pin.ts`)

- Публичная форма записи `PinStore` расширяется обратносовместимо:
  `makePinRecord(pin, salt)` возвращает `{ v: 2, algo: 'scrypt', salt, hash }`.
  Параметры scrypt: N=16384, r=8, p=1, keylen=32, соль 16 байт
  (`crypto.scryptSync`, `maxmem` поднят при необходимости). Сравнение —
  `crypto.timingSafeEqual`.
- Сигнатуры `makePinRecord(pin, salt)` и `verifyPin(record, pin)` остаются
  **синхронными** → `tests/pin.test.ts` проходит без изменений.
- `verifyPin` понимает и legacy-формат `{ salt, hash }` (SHA-256) — для существующих
  установок.
- `PinService.verify`: при успешной проверке legacy-записи файл молча перезаписывается
  в scrypt (прозрачная миграция при следующем успешном вводе).
- Политика lockout (3 неудачи → 30 c) и `failedAttempt()` не меняются.

### B2. safeStorage для EH-куки и аккаунтов

Новый `src/main/services/secret-box.ts`:

- `isEncrypted(v: string): boolean` — проверка префикса `enc:v1:`.
- `encrypt(plain: string): string | null` — при
  `safeStorage.isEncryptionAvailable()` возвращает `enc:v1:` + base64 от
  `safeStorage.encryptString(plain)`; иначе `null`.
- `decrypt(stored: string): string` — `enc:v1:` → `safeStorage.decryptString`;
  legacy-плейнтекст возвращается как есть; битый шифртекст → `''` + предупреждение.

Интеграция:

- `src/main/services/settings.ts`:
  - `read()` расшифровывает поля `onion_cookies_raw`, `nhentai_cookies_raw`,
    `nhentai_onion_cookies_raw`, `senkuro_cookies_raw`.
  - `save()` шифрует эти поля перед записью (если `encrypt` вернул значение;
    иначе оставляет плейнтекст).
  - **В памяти и в IPC — всегда плейнтекст.** `getSettings()`/`setSettings` и
    событие `settingsChanged` не меняют контракт; sync/backup продолжают работать
    как раньше (там эти поля уже помечены секретами через `SECRET_SETTINGS`).
  - Миграция: старый открытый `settings.json` читается как есть; при ближайшем
    `save()` поля шифруются.
- `src/main/services/accounts.ts`:
  - `saveManualAccounts`/`loadManualAccounts` шифруют/расшифровывают весь
    `eh_accounts.json` (base64 + префикс). Legacy-файл читается как JSON и при
    следующем сохранении шифруется.
- Если `safeStorage` недоступен (Linux без keyring): поведение как сейчас
  (плейнтекст) + предупреждение в консоль; приложение продолжает работать.
- `comx-cookie.json` (`comx-gate.ts`) — вне рамок (не EH-куки).

### B3. Google-секрет из env, без fallback

- `src/main/services/google-config.ts`:
  - `GOOGLE_CLIENT_ID` остаётся константой (он публичный).
  - `export const GOOGLE_CLIENT_SECRET = typeof __GOOGLE_CLIENT_SECRET__ === 'string' ? __GOOGLE_CLIENT_SECRET__ : ''`
    + `declare const __GOOGLE_CLIENT_SECRET__: string`.
- `electron.vite.config.ts` (main): `define: { __GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.GOOGLE_CLIENT_SECRET ?? '') }`.
- `vitest.config.ts`: `define: { __GOOGLE_CLIENT_SECRET__: "''" }` (чтобы модуль
  грузился в тестах без env).
- `src/main/services/google-auth.ts`: `login()` и `getAccessToken()` при пустом
  секрете бросают понятную ошибку «GOOGLE_CLIENT_SECRET не задан при сборке — вход
  через Google недоступен».
- `GoogleAuthStatus` (`src/shared/ipc.ts:150`) получает поле `configured: boolean`;
  `Settings.tsx` дизейблит/скрывает кнопку входа, когда `configured === false`.
- Захардкоженный секрет удаляется из репозитория. **Перевыпуск секрета в Google
  Console — ручной шаг пользователя** (фиксируется в CHANGELOG/README, вне кода).

---

## Тесты и проверка

- `npm test` (Windows) — существующие тесты остаются зелёными; целевые: `pin`,
  `settings`, `backup`, `google-auth`, `accounts-parse`.
- Новые тесты:
  - `pin`: legacy SHA-256 запись проходит `verifyPin`, scrypt-запись проходит и
    отдаёт то же поведение lockout.
  - `secret-box`: round-trip `encrypt`/`decrypt`, legacy-плейнтекст читается,
    битый шифртекст → `''`.
  - `settings`: `save()` шифрует cookie-поля на диске, `read()`/`get()` возвращают
    плейнтекст; legacy-файл мигрируется.
  - `ipc/validate`: отвергает не-строки, относительные/несуществующие пути,
    не-папки/не-архивы, URL со схемами `file:`/`javascript:`; пропускает валидные.
- `npm run typecheck`.
- Ручной smoke: запуск приложения; CSP не ломает загрузку картинок `manga://`;
  вход по PIN (старый и новый); открытие локальной папки и `.zip`; вход в каталог;
  кнопка Google при отсутствии env.

## Риски / ограничения

- **Google-секрет:** при обычной сборке из публичного репо без
  `GOOGLE_CLIENT_SECRET` вход через Google отключён. Секрет нужно перевыпустить в
  Google Console (старый считать скомпрометированным). Для desktop OAuth-клиента
  Google не считает секрет конфиденциальным, но в публичном репо его может
  использовать кто угодно для выдачи себя за приложение — поэтому убираем из git.
- **safeStorage на Linux:** без keyring секреты остаются плейнтекстом (осознанный
  компромисс ради работоспособности); на Windows — DPAPI.
- **CSP:** strict-policy может выявить места, где рендерер использует inline/eval
  или сеть напрямую; dev-политика смягчена, prod проверяется smoke-тестом.
- **Пути `openFolder`:** allowlist корней сознательно не вводится (выбран вариант
  «тип + существование»); остаточный риск — открытие произвольной существующей
  папки, но чтение ограничено изображениями через `galleryFromFolder`.
- **Миграция форматов:** обратносовместимая и ленивая; откат WS-B не требует
  обратной миграции, т.к. legacy-плейнтекст всегда читается.

## Вне рамок (YAGNI)

- Апгрейд Electron на актуальную major.
- Разбиение `src/main/index.ts` на модули по доменам.
- ESLint/Prettier, `electron-log`, `noImplicitAny`, устранение `any`/пустых `catch`.
- Разбиение `Catalog.tsx`/`Settings.tsx`.
- Починка тестовой инфраструктуры (zip через Node, mock electron).
- Шифрование `comx-cookie.json` и прочих не-EH секретов.
- Централизованная zod-схема на все 74 IPC-хендлера.
