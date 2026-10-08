# Качество кода и тестовая инфраструктура — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать тесты зелёными на любой ОС (yazl вместо powershell, electron-стаб в vitest), добавить логгер/ESLint/Prettier, удалить TEMP-код, разбить `index.ts` и экраны Catalog/Settings.

**Architecture:** Три фазы. P1 — тестовая инфраструктура. P2 — качество кода (electron-log, ESLint/Prettier, удаление TEMP). P3 — архитектура: `index.ts` → `app/state.ts` + `ipc/*` + `protocol.ts` + `windows.ts`; экраны → хуки/компоненты. Каждая задача — механический перенос без изменения логики, верификация `npm run typecheck` + `npm test` (и `npm run build` на границах фаз).

**Tech Stack:** vitest 2, electron-log, eslint 9 (flat), prettier, typescript-eslint, yazl, electron 33.

## Global Constraints

- Логика/поведение НЕ менять в P1/P3 (только перенос); в P2 — только логгер/линт/удаление TEMP.
- Ни один канал IPC (`CH.*`), ни один тип `src/shared` не меняется.
- Коммиты: только по явному разрешению пользователя (контроллер спрашивает перед каждым коммитом).
- В P1 не ломать новые `vi.mock('electron', …)`-тесты — их явные моки имеют приоритет над alias.
- Стиль: по Prettier-конфигу из T2.2; русские строки/сообщения не менять.
- Вне рамок: апгрейд Electron, исправление всех `any`, всех пустых catch.

---

## Phase 1 — Тестовая инфраструктура

### Task T1.1: zip в Node вместо powershell

**Files:**
- Modify: `package.json` (devDep `yazl`)
- Create: `tests/helpers/make-zip.ts`
- Modify: `tests/zip-gallery.test.ts`

**Interfaces:**
- Produces: `makeTestZip(zipPath: string, files: Record<string, Buffer>): Promise<void>` (асинхронная, т.к. yazl).
- Consumes: нет внешних.

- [ ] **Step 1: Установить `yazl`**

Run: `npm install -D yazl` (вместе с `@types/yazl`, если нужен — yazl поставляется с типами? Проверить; если нет — `npm install -D@types/yazl`).
Expected: `package.json` содержит `yazl` в devDependencies.

- [ ] **Step 2: Создать `tests/helpers/make-zip.ts`**

```ts
import { ZipFile } from 'yazl'
import { createWriteStream } from 'fs'

export function makeTestZip(zipPath: string, files: Record<string, Buffer>): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile()
    for (const [name, content] of Object.entries(files)) {
      zip.addBuffer(content, name)
    }
    zip.outputStream.pipe(createWriteStream(zipPath)).on('close', () => resolve()).on('error', reject)
    zip.end()
  })
}
```

- [ ] **Step 3: Переписать `tests/zip-gallery.test.ts`**

- Убрать `execSync` импорт и функцию `makeTestZip` (powershell).
- Импортировать `makeTestZip` из `./helpers/make-zip`.
- Все вызовы `makeTestZip(zip, …)` становятся `await makeTestZip(zip, …)` (все тесты уже async — просто добавить `await`).
- Убрать `mkdirSync`/`staging` логику (больше не нужна).

- [ ] **Step 4: Проверить**

Run: `npx vitest run tests/zip-gallery.test.ts`
Expected: PASS (5 тестов). Это работает и на Windows, и на Linux (чисто-Node).

- [ ] **Step 5: Полная проверка**

Run: `npm run typecheck` и `npm test`
Expected: зелёные (без ОС-специфичного 失败).

### Task T1.2: глобальный electron-стаб в vitest

**Files:**
- Create: `tests/electron-mock.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces: модуль-стаб с именованными экспортами `app, BrowserWindow, session, ipcMain, protocol, net, safeStorage, dialog, shell, clipboard, nativeTheme`.
- Consumes: ничего.

- [ ] **Step 1: Создать `tests/electron-mock.ts`** — минимально-рабочий стаб:

```ts
import { tmpdir } from 'os'
import { join } from 'path'

const noop = (): void => {}
const resolved = async (): Promise<void> => undefined

const webContents = {
  send: noop, on: noop, once: noop, off: noop, removeListener: noop,
  executeJavaScript: async () => undefined,
  loadURL: resolved, loadFile: resolved,
  getURL: () => '', isLoadingMainFrame: () => false,
  setWindowOpenHandler: noop, getAllWindows: () => []
}

class BrowserWindow {
  static getAllWindows(): BrowserWindow[] { return [] }
  webContents = webContents
  on = noop; once = noop; off = noop
  close = noop; destroy = noop; isDestroyed = () => false
  setTitle = noop; show = noop; focus = noop; setMenuBarVisibility = noop
}

const defaultStorage = {
  webRequest: { onBeforeRequest: noop, onHeadersReceived: noop, onBeforeSendHeaders: noop, onCompleted: noop },
  cookies: { get: async () => [], set: async () => {}, remove: async () => {} },
  setProxy: resolved, setPermissionRequestHandler: noop, setPermissionCheckHandler: noop
}

const session = {
  fromPartition: () => defaultStorage,
  defaultSession: defaultStorage
}

const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString('utf8')
}

const httpFetchStub = async (url: string) => new Response('mocked', { status: 200 })

export {
  BrowserWindow, session, ipcMain: { handle: noop },
  protocol: { registerSchemesAsPrivileged: noop, handle: resolved },
  net: { fetch: httpFetchStub },
  safeStorage, dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: '' }),
    showErrorBox: noop
  },
  shell: { openExternal: resolved },
  clipboard: { readText: () => '', writeText: noop },
  nativeTheme: { shouldUseDarkColors: () => true },
  app: {
    getPath: () => join(tmpdir(), 'electron-mock-userdata'),
    getAppPath: () => join(tmpdir(), 'electron-mock-app'),
    getVersion: () => '0.0.0-test',
    whenReady: resolved, on: noop, once: noop,
    commandLine: { appendSwitch: noop },
    quit: noop, requestSingleInstanceLock: () => true
  }
}
```

Примечание: это «подстраховка». Если какой-то тест вызывает метод, которого нет в стабе — белый список расширяем по фактической ошибке (задача реализатора — добиться зелёного прогона, расширяя стаб, а не меняя прод-код).

- [ ] **Step 2: Подключить alias в `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      electron: resolve('tests/electron-mock.ts')
    }
  },
  define: { __GOOGLE_CLIENT_SECRET__: "''" },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
})
```

- [ ] **Step 3: Полный прогон**

Run: `npm test`
Expected: 62 файла / 280 тестов зелёные; теперь импорты `electron` в любом тесте разрешаются в стаб (не в строку-путь), и на Linux те же модули прогружаются.

- [ ] **Step 4: Проверка typecheck**

Run: `npm run typecheck`
Expected: чисто (tests не входит в include, но vitest трансформирует их сам).

### Task T1.3: Commit после Phase 1 (спросить пользователя)

---

## Phase 2 — Качество кода

### Task T2.1: electron-log + замена console.log

**Files:**
- Modify: `package.json` (dep `electron-log`)
- Create: `src/main/services/logger.ts`
- Modify: все файлы `src/main` с `console.log` (31 шт.) — на `logger.*`

**Interfaces:**
- Produces: `src/main/services/logger.ts`:
```ts
import log from 'electron-log/main'
log.transports.file.level = 'info'
log.transports.console.level = 'debug'
export const logger = log
```
(в P3 при переносе кода сохраняются вызовы `logger.*`).

- [ ] **Step 1: Установить electron-log**

Run: `npm install electron-log`
- [ ] **Step 2: Создать `logger.ts`** (как выше).
- [ ] **Step 3: Замена console.log**

В `src/main/**/*.ts` (кроме `logger.ts`) заменить:
- `console.log(...)` → `logger.info(...)`
- `console.warn(...)` → `logger.warn(...)`
- `console.error(...)` → `logger.error(...)`
Сохранить аргументы. В `logger` НЕ вызывать console напрямую (это и есть цель).

Примечание: `console.log` в `src/renderer` НЕ трогаем (вне рамок).

- [ ] **Step 4: Пустые catch в затронутых файлах**

В файлах, которые правит эта задача (и которые попадут в P3-перенос), самые «молчаливые» `catch { }`/`catch { /* ignore */ }` в горячих местах получить `logger.warn(...)` с контекстом (по 2-5 на файл на усмотрение реализатора). Не гоняться за всеми 120.

- [ ] **Step 5: Проверка**

Run: `npm run typecheck` и `npm test`
Expected: зелёные. electron-log не импортируется ни одним тестом → стаб не нужен (но если тест упадёт — расширить стаб: `electron-log/main` мокается через усиление electron-mock или `deps`).

### Task T2.2: ESLint + Prettier

**Files:**
- Modify: `package.json`
- Create: `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`

**Interfaces:**
- `npm run lint` → `eslint .`
- `npm run format` → `prettier --write .`
- `npm run format:check` → `prettier --check .`

- [ ] **Step 1: Установить зависимости**

Run: `npm install -D eslint prettier @eslint/js typescript-eslint eslint-config-prettier eslint-plugin-react-hooks eslint-plugin-react-refresh`

- [ ] **Step 2: `eslint.config.mjs`** (flat):

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['out', 'dist', 'node_modules', 'docs', 'build'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  },
  prettier
)
```

- [ ] **Step 3: `.prettierrc.json`**

```json
{ "singleQuote": true, "semi": true, "trailingComma": "all", "printWidth": 140 }
```
И `.prettierignore`: `out`, `dist`, `node_modules`, `package-lock.json`.

- [ ] **Step 4: Скрипты в package.json** (как в Interfaces) и `npm run format` (применить), затем `npm run lint`.

Expected: `format` вносит большой форматирующий дифф (отдельный коммит). `lint` показывает ошибки/warnings; **не исправляем** все `any`, но фиксируем простые (unused imports, obvious). Нулевой `eslint` может не достигаться — допустимо оставить warning'и; задача — рабочие конфиг и скрипты, без красных ошибок в `out`/`dist`.
Примечание: если после `npm run format` typecheck падает (что-то поломалось форматированием — не должно) — откатывать и разбираться.

- [ ] **Step 5: Проверка** — `npm run typecheck`, `npm test`, `npm run lint` (без fail на warnings), `npm run format:check` должен пройти ПОСЛЕ `format`.

### Task T2.3: удаление TEMP-кода и отладочных скриптов

**Files:**
- Modify: `src/main/index.ts` (удалить 2 блока + лишние импорты)
- Delete: корневые скрипты

- [ ] **Step 1: Удалить блок `MR_AUTO_LOGIN`** (от `if (process.env.MR_AUTO_LOGIN) {...}` до закрытия) из `index.ts`.
- [ ] **Step 2: Удалить блок `MR_HTTP_DEBUG`** (аналогично).
- [ ] **Step 3: Почистить ставшие неиспользуемыми импорты** (например, dynamic `./services/login` используется в `loginSite` — оставить; проверить `console.log` не осталось лишних).
- [ ] **Step 4: Удалить корневые скрипты**:

```bash
git rm --force \
  autoverify.ts cx-ch.ts "cx-ch???.ts" cx-final.ts cx-r.ts cx-r2.ts \
  cx10.ts cx11.ts cx12.ts cx13.ts cx14.ts cx16.ts cx17.ts cx18.ts cx19.ts \
  cx2.ts cx20.ts cx21.ts cx22.ts cx23.ts cx24.ts cx25.ts cx26.ts cx4.ts cx5.ts \
  cx6.ts cx7.ts cx8.ts cx9.ts lix.ts ml-browser.ts ml-browser2.ts
```
(файл с непечатаемым именем удалить через `Get-ChildItem -Name "cx-ch*"`).

- [ ] **Step 5: Убедиться**, что ни tsconfig, ни vite, ни тесты не упоминают эти файлы (grep по именам).
- [ ] **Step 6: Проверка** — `npm run typecheck`, `npm test`, `npm run build`.

### Task T2.4: Commit после Phase 2 (спросить пользователя; вероятно 2-3 коммита: logger, lint+format, cleanup)

---

## Phase 3 — Архитектура

### Task T3.1: `app/state.ts` + `windows.ts`

**Files:**
- Create: `src/main/app/state.ts`, `src/main/windows.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- `src/main/app/state.ts` — переместить модульные реестры из index.ts:
  - `galleries: Map<string, Gallery>`, `zipMeta`, `onlineHeaders`, `coverCache`, `coverInFlight`, `coverDisk` (getter `getCoverDisk()`), `groupleCache`, `groupleWarming`, `ZIP_TMP`.
  - Экспорт: самих реестров + `getCover(url, settings, exCookieHeader)`? — **не усложнять**: переносим только данные и тривиальные геттеры; функции, зависящие от настроек, остаются в index и передаются по месту.
- `src/main/windows.ts`: экспорт `createWindow(): void` (перенос текущего `createWindow` целиком) + `registerLifecycle(cleanup)` (activate/window-all-closed/will-quit с `clearZipTmpAll`/`shutdownBrowserFetch`).

- [ ] **Step 1:** Перенести реестры в `state.ts`, импортировать в index (маппинг без изменения логики).
- [ ] **Step 2:** Перенести `createWindow` в `windows.ts`; в index вызвать `createWindow()`.
- [ ] **Step 3:** Перенести lifecycle-обработчики (activate/window-all-closed/will-quit) в `windows.ts` через экспортируемую функцию `registerLifecycle({ onWillQuit })`, где `onWillQuit` в index вызывает `clearZipTmpAll(ZIP_TMP)` + `shutdownBrowserFetch()`.
- [ ] **Step 4:** `npm run typecheck` и `npm test` зелёные.

### Task T3.2: `protocol.ts`

**Files:**
- Create: `src/main/protocol.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- `registerMangaProtocol(deps: { settings(): Settings; getCover(url): Promise<Buffer>; whenEmbeddedTorReady(ms): Promise<void> }): void` — перенос `registerSchemesAsPrivileged` и всего `protocol.handle('manga', ...)` тела.
- `import { registerMangaProtocol } from './protocol'`.

- [ ] **Step 1:** Перенести `registerSchemesAsPrivileged` + `protocol.handle('manga', ...)` в `protocol.ts` (использует `parseMangaPageUrl`, `zipMeta`, `galleries`, `onlineHeaders`, `requestPage`, `readZipEntry`, `net.fetch`, `pathToFileURL`, `ZIP_TMP`).
- [ ] **Step 2:** В index вызвать `registerMangaProtocol({ settings, getCover, whenEmbeddedTorReady })`.
- [ ] **Step 3:** `npm run typecheck`, `npm test`, `npm run build`.

### Task T3.3: `ipc/settings.ts`, `ipc/pin.ts`

**Files:**
- Create: `src/main/ipc/settings.ts`, `src/main/ipc/pin.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- `registerSettings(deps: { settings; sync; coverDisk; repo; exAccounts; downloads; db }): void` — `getSettings`, `setSettings`, `markChapterRead`, `backupExport`, `backupImport`, `coverCacheInfo`, `coverCacheClear`.
- `registerPin(deps: { pin }): void` — `pinHasPin/pinSetPin/pinRemovePin/pinVerifyPin/pinFailedAttempt`.

- [ ] **Step 1-2:** Перенести тела хендлеров из index (логику не менять; `settingsCreatedAt`/`persistSyncState` для backup — в index остаются или передаются в deps).
- [ ] **Step 3:** В index `registerSettings(...)`, `registerPin(...)` (вместо `ipcMain.handle` строк).
- [ ] **Step 4:** `npm run typecheck`, `npm test`.

### Task T3.4: `ipc/library.ts`

**Files:**
- Create: `src/main/ipc/library.ts`; Modify: index.ts
**Interfaces:**
- `registerLibrary(deps: { library; history; settings; sync; broadcastLibrary(): void; coverCacheClearFn(): Promise<void> }): void` — `library*`, `recordProgress`, `clearHistory`, `libraryChanged` broadcast, `coverCacheInfo/Clear`.

- [ ] Шаги как в T3.3 (перенос + вызов). Проверка: `npm run typecheck`, `npm test`.

### Task T3.5: `ipc/downloads.ts`

**Files:**
- Create: `src/main/ipc/downloads.ts`; Modify: index.ts
**Interfaces:**
- `registerDownloads(deps: { downloads; settings; effectiveTorSocks(): string; exAccounts; resolveGallery; fetchChapterCountSafe(...) }): void` — downloads*, ehArchiveCost/Buy, downloadsAddArchive, downloadsCheckChapters/Updates, downloadsPickDir.
- `archiverUrlFor` и `downloadFetchOpts` — в deps или локально (вынести в общий `app/http-helpers.ts`? — оставить локальными в модуле).

### Task T3.6: `ipc/catalog.ts`

**Files:**
- Create: `src/main/ipc/catalog.ts`; Modify: index.ts
**Interfaces:**
- `registerCatalog(deps: { settings; effectiveTorSocks(); groupleCache; refreshGroupleCache(...); exAccounts; whenEmbeddedTorReady(...); GROUPLE_SITES; broadcastNhentaiCounts(...) }): void` — `searchCatalog`, `catalogPopular`, `fetchChapterList`, `fetchChapterCountSafe`, `ehTagSuggest`, `nhentaiTagSuggest`, `checkTor`, `checkBridges`, `checkSites`, `libMirrorsCheck`, `customDnsCheck`, `fetchChapterListSafe`.
- Обработчики `fetchChapterListFor`/`fetchChapterListSafe`/`fetchChapterCountSafe` — перенести целиком (они внутри).

### Task T3.7: `ipc/gallery.ts`

**Files:**
- Create: `src/main/ipc/gallery.ts`; Modify: index.ts
**Interfaces:**
- `registerGallery(deps: { settings; history; library; exAccounts; effectiveTorSocks(); galleries; zipMeta; onlineHeaders; resolveGallery; createOnlineGallery; NOT }): void` — `openUrl`, `setReadingPosition`, `openFolder` (top-level fn), `rescanFolder`.
- `openFolder` — переносится из конца index.ts в gallery.ts (экспорт `openFolderLocal(...)`).

### Task T3.8: `ipc/accounts.ts`

**Files:**
- Create: `src/main/ipc/accounts.ts`; Modify: index.ts
**Interfaces:**
- `registerAccounts(deps: { settings; exAccounts; effectiveTorSocks(); runLoginWindow }): void` — `getExAccounts/setExAccount/addExAccount/removeExAccount/importExAccounts`, `loginSite`, `loginPassword`, `cookieLogin`, `refreshIgneous`, `parseCookieText`.

### Task T3.9: `ipc/sync.ts`

**Files:**
- Create: `src/main/ipc/sync.ts`; Modify: index.ts
**Interfaces:**
- `registerSync(deps: { googleAuth; sync; broadcastSettings?: () => void }): void` — `googleAuthStatus/login/logout`, `syncNow`, `syncGetState`; событие `syncChanged` broadcast (передаётся из index или модулем).

### Task T3.10: средняя сборка index.ts

После T3.1-T3.9 `src/main/index.ts` должен остаться только: импорты, `const settings/history/... = new Service(...)`, создание sync/googleAuth/downloads, вызовы `registerX(...)`, `createWindow()`, `app.whenReady` блок без хендлеров. Прогнать `npm run typecheck`, `npm test`, `npm run build`. Проверить отсутствие висящих `ipcMain.handle` вне модулей (grep).

### Task T3.11: Catalog.tsx → хуки/компоненты

**Files:**
- Create: `src/renderer/src/screens/catalog/useCatalogSearch.ts`, `.../QuickSearchPresets.tsx`, `.../FilterPanel.tsx` (по факту текущего кода)
- Modify: `src/renderer/src/screens/Catalog.tsx` (уменьшить объём)

**Interfaces:**
- `useCatalogSearch()` возвращает: source/query/page/sort/filters/cursor, load()/next(), setSource/setQuery/setFilters, topRef-скролл-логика, состояния loading/error/items.
- Компоненты принимают текущие пропсы из хука.

- [ ] **Step 1:** Прочитать Catalog.tsx, выделить состояния поиска в хук (без изменения поведения).
- [ ] **Step 2:** Вынести крупные блоки JSX (поисковая строка+теги, фильтры по источнику, панель категорий, контекст-меню карточек) в компоненты.
- [ ] **Step 3:** `npm run typecheck` (web) и `npm test` (renderer-тестов нет — но typecheck обязателен). Финальный smoke UI за пользователем (вне авто).

### Task T3.12: Settings.tsx → секции/хук

**Files:**
- Create: `src/renderer/src/screens/settings/useSettings.ts`, `.../SettingsSection.tsx` (тип Section-props), файлы под крупные секции (E-Hentai accounts, Sync/Google, Backup, Downloads, Network/Tor)
- Modify: `src/renderer/src/screens/Settings.tsx` (оркестратор)

**Interfaces:**
- `useSettings()`: settings state + `upd(patch)` + debounce persist; возвращает `{ settings, upd, sync, google, ... }` как есть сейчас в компоненте.
- Каждая секция — компонент, принимающий `{ settings, upd }` и локальные состояния.

- [ ] **Step 1:** Выделить `useSettings` (состояние + `upd` + загрузка).
- [ ] **Step 2:** Каждую `<Section>` в компонент `settings/XSection.tsx` (E-Hentai-секция с clipboard-автодетектом остаётся поведенчески тем же).
- [ ] **Step 3:** `npm run typecheck` и `npm test`. Smoke UI за пользователем.

### Task T3.13: Commit после Phase 3 (спросить пользователя; серия коммитов по T3.x)

---

## Self-Review (набросок)

- P1: единственный powershell-тест убран; electron alias на стаб; зелёный прогон.
- P2: logger на месте, console.log заменены; eslint/prettier рабочие; TEMP удалён; корневые скрипты удалены; typecheck+tests+build зелёные.
- P3: index.ts без DOM-логики (только boot); все CH-каналы перенесены без изменений имён; экраны разбиты; typecheck+tests+build зелёные; manual smoke UI отмечен как «за пользователем».
- Согласованность имён: `registerX(deps)` во всех файлах; цели хендлеров совпадают с CH-каналом 1:1.