# Качество кода и тестовая инфраструктура — Design Spec

Дата: 2026-10-09
Статус: approved (решения пользователя: electron-log; TEMP-код и корневые скрипты удалить; пустые catch — только затронутые файлы; порядок 1→2→3 с чекапами)

Три субпроекта, каждый отдельно мержится и проверяется:
1. **Тестовая инфраструктура** — зелёный прогон на любой ОС (чинит ваш Linux-прогон).
2. **Качество кода** — логгер, ESLint/Prettier, удаление TEMP-кода.
3. **Архитектура** — разбиение `index.ts`, экранов Catalog/Settings.

Вне рамках: апгрейд Electron / npm audit (это 🔴-остаток, не входил в два блока).

---

## Субпроект 1 — Тестовая инфраструктура

Цель: тесты не зависят от ОС и от реального Electron.

### 1.1 Замена zip через powershell (`tests/zip-gallery.test.ts`)

Сейчас один хелпер `makeTestZip` вызывает `powershell Compress-Archive` (используется 4 тестами) и работает только на Windows.

- Добавить `yazl` в `devDependencies` (companion к уже используемому `yauzl`, чисто-Node, без нативки).
- Переписать `makeTestZip` на `yazl` (синхронная запись через zipFile.addBuffer + end + finish).
- Вспомогательный `tests/helpers/make-zip.ts` с экспортом `makeTestZip(zipPath, files: Record<string, Buffer>)` — reuse и для других тестов при необходимости.

### 1.2 Глобальный mock `electron` в vitest

10 модулей `src/main` импортируют electron напрямую (`index.ts`, `validate.ts`, `accounts.ts`, `security.ts`, `browser-fetch.ts`, `eh-limits-instance.ts`, `google-auth.ts`, `login.ts`, `secret-box.ts`, `tor-embedded.ts`). Тесты их (напрямую или транзитивно) в среде node без electron не могут подхватить разумное значение (`require('electron')` возвращает строку-путь к бинарю).

- Создать `tests/electron-mock.ts` — стаб с минимально-рабочей поверхностью:
  - `app`: `getPath()` → значение из теста/`tmpdir`, `whenReady()` → resolved promise, `on()`/`once()` → noop, `commandLine`/`quit()` → noop.
  - `BrowserWindow`: класс-заглушка с `webContents` (send/on/off/executeJavaScript/loadURL/loadFile), `on/once`, `close/destroy/isDestroyed`, `setTitle/show/focus`; статический `getAllWindows()` → `[]`.
  - `session`: `fromPartition()` → стаб-сессия (webRequest hooks noop, `setProxy`→resolved, `cookies.get`→`[]`, permission handlers noop); `defaultSession`.
  - `ipcMain`: `handle()` → noop; `ipcRenderer` (для полноты).
  - `protocol`: `registerSchemesAsPrivileged`/`handle` noop; `net`: `fetch` → `new Response('')`.
  - `safeStorage`: `isEncryptionAvailable()` → `false` (по умолчанию), `encryptString`/`decryptString` — минимальные (round-trip через base64, без DPAPI).
  - `dialog`: showOpenDialog/showSaveDialog → `{ canceled: true }`, showErrorBox noop. `shell`, `clipboard`, `nativeTheme` — минимальные noop.
- В `vitest.config.ts` добавить `resolve.alias: { electron: resolve('tests/electron-mock.ts') }`, чтобы ЛЮБОЙ импорт `electron` в тестах разрешался в стаб.
  - Явные `vi.mock('electron', …)` в существующих новых тестах (secret-box, settings-service, accounts-secret, ipc-validate) имеют приоритет над alias — их точные моки сохраняются.

Целевая проверка: полный `npm test` зелёный на Windows; на Linux те же тесты не должны падать по причинам powershell/electron (проверка — CI/у вас; здесь подтверждаем отсутствие ОС-специфичных вызовов).

---

## Субпроект 2 — Качество кода

### 2.1 Логгер на базе electron-log

- Добавить `electron-log` в `dependencies`.
- Новый `src/main/services/logger.ts`:
  - `logger = require('electron-log')`-совместимая обёртка с уровнями `debug/info/warn/error`.
  - В тестах (без electron) — не использовать (модуль не импортируется тестами; при необходимости — через стаб).
- Заменить 31 `console.log` в `src/main` на `logger.info`/`logger.warn` (первые 2 аргумента сохраняются; формат вывода не менять).
- Пустые `catch{}`/`catch { /* ignore */ }` — **только в файлах, которые уже правим** (index.ts, экраны, затронутые сервисы): наиболее «молчаливые» и падающие в рантайме получают `logger.warn(...)` с контекстом; осознанно-тихие — оставляем с коротким комментарием. Полный 120-проход — вне рамок (зафиксировано).
- `src/renderer` — `console.log` не заменяем (это UI; логгер main-process).

### 2.2 ESLint + Prettier

- `devDependencies`: `eslint`, `prettier`, `@eslint/js`, `typescript-eslint` (eslint-plugin-typescript-eslint), `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` (по необходимости), `eslint-config-prettier`.
- `eslint.config.mjs` (flat config):
  - `typescript-eslint` recommended; `@typescript-eslint/no-explicit-any: 'warn'`; react-hooks recommended.
  - `ignores`: `out`, `dist`, `node_modules`, корневые отладочные скрипты (будут удалены), `tests` исключать из strict-правил при необходимости.
- `.prettierrc.json`: `semi: false`?? — учитывать текущий стиль (`withoutSemi: false`, single quotes, trailing). Посмотреть существующий стиль: в коде `;` есть, `'` одиночные кавычки. Prettier: `{ "singleQuote": true, "semi": true, "trailingComma": "all" }` (соответствует коду).
- `package.json` скрипты: `lint` (eslint .), `format` (prettier --write .), `format:check` (prettier --check .).
- `format` выполняется и вносит правки форматирования (большой дифф) — допустимо, это отдельный коммит. `lint` запускается в CI/development; не блокирует немедленно фиксами всех any (warn).

Вне рамок: исправление всех 133 `any` (только диагностика через warn).

### 2.3 Удаление TEMP-кода и отладочных скриптов

- Удалить из `src/main/index.ts` два env-gated TEMP-блока:
  - `MR_AUTO_LOGIN` (~строки 95-118)
  - `MR_HTTP_DEBUG` (~строки 120-144)
  и неиспользуемые после этого импорты (login.ts dynamic import остаётся для `loginSite`; проверить).
- Удалить корневые отладочные скрипты (~31 файл): `cx*.ts`, `ml-browser.ts`, `ml-browser2.ts`, `lix.ts`, `autoverify.ts` (а также `cx-ch???.ts` — файл с непечатаемым именем). Восстановимы из git-истории.
- Проверить, что эти файлы не упоминаются в tsconfig/vite/тестах (не входят в сборку).

---

## Субпроект 3 — Архитектура

### 3.1 Разбиение `src/main/index.ts` (1 072 строки)

Общая стратегия: выделяем **контекст приложения** (объект с сервисами и реестрами) и регистрируем IPC-хендлеры по доменам; поведение и порядок регистрации идентичны. Верификация: typecheck + полный `npm test` + `npm run build` после каждого шага.

Новые файлы:
- `src/main/app/context.ts` — интерфейс/фабрика `AppContext` (settings, history, library, exAccounts, downloads, pin, sync, googleAuth, registry-мапы `galleries/zipMeta/onlineHeaders/coverCache`, хелперы `effectiveTorSocks`, `downloadFetchOpts`, `openFolder`, `broadcastLibrary`, `getCover`, `groupleCache`, прочее общее состояние).
- `src/main/ipc/settings.ts` — `getSettings/setSettings`, `markChapterRead`, backup export/import, coverCache.
- `src/main/ipc/library.ts` — library*/history/recordProgress/clearHistory/favorites.
- `src/main/ipc/downloads.ts` — downloads* + ehArchive*.
- `src/main/ipc/catalog.ts` — searchCatalog/catalogPopular/fetchChapterList/(chapter counts)/tags/checks (tor/bridges/sites/libMirrors/customDns).
- `src/main/ipc/gallery.ts` — openFolder/rescanFolder/openUrl/setReadingPosition.
- `src/main/ipc/accounts.ts` — ex-аккаунты, cookieLogin/passwordLogin/refreshIgneous/parseCookie, loginSite.
- `src/main/ipc/pin.ts` — pinHasPin/pinSetPin/pinRemovePin/pinVerifyPin/pinFailedAttempt.
- `src/main/ipc/sync.ts` — googleAuthStatus/login/logout, syncNow/syncGetState.
- `src/main/protocol.ts` — `protocol.handle('manga', …)` + `registerSchemesAsPrivileged`.
- `src/main/windows.ts` — `createWindow()` + lifecycle (activate/window-all-closed/will-quit).
- `src/main/index.ts` — boot: `app.whenReady` создаёт сервисы и контекст, вызывает `register*` и `createWindow`.

Порядок шагов (минимальный риск):
1. Выделить `windows.ts` + жизненный цикл (самый изолированный кусок).
2. Выделить `protocol.ts`.
3. Создать `context.ts` и по одному переносить группы IPC-хендлеров в `ipc/*`, сверяя typecheck+tests+build после каждой группы.

Гарантии:
- Ни один канал IPC не меняется (CH-константы не трогаем).
- Обработчики don’t меняют логику; только перемещение в функции `registerX(ctx)`.
- Порядок регистрации (после создания сервисов) сохраняется.

### 3.2 Разбиение экранов Catalog.tsx (795) / Settings.tsx (807)

**Catalog.tsx:**
- Выделить хуки: `useCatalogSearch` (состояние source/query/page/sort/filters/cursor, вызов `window.api.searchCatalog`, инкрементальная подгрузка, скролл-топ при фильтрах), `useFavoriteShortcuts` (контекст-меню карточек) — по факту текущего кода.
- Выделить компоненты: `SearchBar`/`TagBar`, `FilterPanel` (по источникам), `CatalogCardGrid` (переиспользует `MangaCardGrid`), `CatalogCardMenu`, `QuickSearchPresets`.
- Ожидаемый результат: Catalog.tsx — композиция без бизнес-логики поиска внутри (логика в хуках/компонентах), визуальное поведение идентично.

**Settings.tsx:**
- `SettingsPage` остаётся оркестратором (загрузка/сохранение настроек через `window.api`).
- Каждая `<Section>` в отдельный файл `settings/Section*.tsx` или `settings/`-группа: Reading/UI, Network/Tor, Cookies/Accounts (E-Hentai, включая clipboard-автодетект), Sync (Google), Downloads, Backup, Library.
- Выделить хук `useSettings` (состояние + `upd()` + persist-дебаунс).
- Поведение и русские строки — без изменений.

Верификация: typecheck + тесты + build; ручной smoke UI (пользователь).

---

## Порядок исполнения и чекапы

1. Суб1 (тесты) → чекап.
2. Суб2 (качество кода) → чекап.
3. Суб3 (архитектура) → чекап.
Каждый субпроект — свой план и свой коммит-набор; после каждого показываем результат.

## Риски

- **Суб3 (index.ts)**: наибольший риск регрессий (1072 строки, 74 хендлера). Митигация: строго механический перенос + полная тест-петля после каждой группы; никакого изменения логики.
- **Экраны**: UI-регрессии незаметны автотестами. Митигация: только перенос кода, типчеки; финальный ручной smoke за пользователем.
- **Prettier --write**: большой форматирующий дифф; отдельным коммитом, чтобы ревью оставалось читаемым.
- **electron-mock alias**: может раскрыть тесты, которые полагались на реальный electron в node-среде (их нет — в node реального electron не бывает). Если alias сломает тест, который раньше проходил — правим причину теста, а не откатываем alias (из документации reviewer).

## Вне рамок (YAGNI)

- Апгрейд Electron; `npm audit` fix.
- Исправление всех 133 `any` (только eslint-warn).
- Все 120 пустых catch (только затронутые файлы).
- Разбиение остальных экранов/renderer (только Catalog/Settings).
- Логирование в renderer.