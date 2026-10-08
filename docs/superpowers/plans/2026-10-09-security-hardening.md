# Закалка безопасности Electron-приложения — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть блок «🔴 Безопасность» из ревью: закалка окон, CSP, default-deny прав, zod-валидация опасных IPC, PIN на scrypt, safeStorage для EH-куки, Google-секрет из env.

**Architecture:** Два независимых набора правок. WS-A — процессы и граница IPC (`src/main/security.ts` + правки окон + `src/main/ipc/validate.ts`). WS-B — секреты на диске (`src/main/services/secret-box.ts` + `pin.ts`, `settings.ts`, `accounts.ts`, `google-config.ts`). Все изменения обратносовместимы; миграции ленивые.

**Tech Stack:** Electron 33 (без апгрейда), zod ^3, Node crypto (`scryptSync`, `timingSafeEqual`), Electron `safeStorage`, electron-vite `define`, vitest.

## Global Constraints

- Не менять контракты IPC с рендерером: `getSettings()`/`setSettings`/`settingsChanged` всегда отдают плейнтекст настроек.
- В памяти приложения секреты всегда плейнтекст; шифрование — только на диске.
- Коммиты: только по явному разрешению пользователя (план содержит шаги «git commit», но исполнитель обязан спросить перед коммитом).
- Тесты запускаются в среде node без Electron; любые новые тесты, импортирующие модули с `electron`, обязаны `vi.mock('electron', …)`.
- Стиль кода: без изменений вне области задач; без новых зависимостей кроме `zod`.
- Русские сообщения об ошибках (как в остальном коде).

---

### Task A1: Модуль закалки процессов + главное окно + CSP

**Files:**
- Create: `src/main/security.ts`
- Modify: `src/main/index.ts` (imports; `createWindow`; `app.whenReady`)

**Interfaces:**
- Produces:
  - `installAppCsp(devUrl?: string): void` — ставит CSP на `session.defaultSession` (только `mainFrame`).
  - `installDefaultPermissions(ses: Session): void` — разрешает только clipboard-read/write, остальное deny.
  - `denyAllPermissions(ses: Session): void` — deny всё.

- [ ] **Step 1: Создать `src/main/security.ts`**

```ts
import { session, type Session } from 'electron'

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' manga: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ')

const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' manga: data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** CSP заголовком для документа главного окна (dev/prod раздельно). */
export function installAppCsp(devUrl: string | undefined): void {
  const policy = devUrl ? DEV_CSP : PROD_CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame') { callback({}); return }
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } })
  })
}

const CLIPBOARD_PERMS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'clipboard-sans-sanitized-write'])

/** Default-deny с allowlist буфера обмена (Settings читает clipboard). */
export function installDefaultPermissions(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(CLIPBOARD_PERMS.has(permission)))
  ses.setPermissionCheckHandler(() => false)
}

/** Полный deny (для скрейпер-окна и сессий логина). */
export function denyAllPermissions(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
}
```

Примечание: `security.ts` импортирует electron статически; в тестовой среде он не импортируется ни одним тестом, поэтому мокать electron для него не требуется. Остальные функции принимают `Session` параметром.

- [ ] **Step 2: Проверка typecheck**

Run: `npm run typecheck`
Expected: компиляция без новых ошибок (файл ещё не подключён — проверяем синтаксис).

- [ ] **Step 3: Подключить в `src/main/index.ts`**

Добавить в импорт Electron: `session`. Добавить `import { installAppCsp, installDefaultPermissions, denyAllPermissions } from './security'`.

В `app.whenReady()` первыми строками (до `createWindow()`):

```ts
installAppCsp(process.env['ELECTRON_RENDERER_URL'])
installDefaultPermissions(session.defaultSession)
denyAllPermissions(session.fromPartition('persist:browsing'))
denyAllPermissions(session.fromPartition('persist:google-oauth'))
```

- [ ] **Step 4: Закалить главное окно в `createWindow()`**

Заменить создание окна:

```ts
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 480, minHeight: 360,
    backgroundColor: '#000000', autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    let allowed = false
    try {
      const devUrl = process.env['ELECTRON_RENDERER_URL']
      const u = new URL(url)
      if (devUrl) allowed = u.origin === new URL(devUrl).origin
      else allowed = u.protocol === 'file:'
    } catch { allowed = false }
    if (!allowed) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
  // Hidden helper windows … (осталось без изменений)
  win.on('closed', () => { if (process.platform !== 'darwin') app.quit() })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
      console.log('[main-window] load fail', code, desc, url, 'main:', isMain)
    })
    win.webContents.on('console-message', (_e, _lvl, msg, line, src) => {
      console.log(`[main-window-console] (${src ?? '?'}:${line ?? '?'}): ${String(msg).slice(0, 300)}`)
    })
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
```

- [ ] **Step 5: Проверка typecheck и существующих тестов**

Run: `npm run typecheck` и `npm test`
Expected: компиляция; все существующие тесты проходят.

- [ ] **Step 6: Ручной smoke (обязателен перед признанием задачи готовой)**
  - `npm run dev` и `npm run build && npm run preview` — главное окно открывается, картинки `manga://` грузятся (CSP не мешает), консоль без блокировок.
  - В DevTools выполнить `window.open('https://example.com')` → окно не откроется.
  - Проверить, что кнопка «Вставить из буфера» в Settings (чтение clipboard) работает.

- [ ] **Step 7: Commit** (спросить пользователя перед `git commit`)

---

### Task A2: Закалка окна browser-fetch

**Files:**
- Modify: `src/main/services/browser-fetch.ts`

**Interfaces:**
- Consumes: `denyAllPermissions` из `src/main/security.ts`.
- Produces: окно скрейпера с `contextIsolation: false` (без изменений), но `nodeIntegration: false`, `sandbox: true`; deny на window.open и не-http навигацию.

- [ ] **Step 1: Усилить `prepareSession()`**

Добавить импорт `denyAllPermissions` и в `prepareSession()` после создания сессии:

```ts
function prepareSession(): Electron.Session {
  if (ses) return ses
  const s = session.fromPartition(PARTITION, { cache: false })
  denyAllPermissions(s)
  s.webRequest.onBeforeRequest((details, callback) => {
    const allow = ALLOWED_RESOURCE_TYPES.includes(details.resourceType)
    callback({ cancel: !allow })
  })
  ses = s
  return s
}
```

- [ ] **Step 2: Закалить окно в `ensureBrowser()`**

Заменить создание окна:

```ts
  win = new BrowserWindow({
    show: false, width: 1024, height: 768,
    webPreferences: {
      session: s,
      javascript: true, images: false, webSecurity: true,
      nodeIntegration: false,
      contextIsolation: false,
      sandbox: true,
      preload: preloadPath
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    let ok = false
    try { ok = /^https?:$/.test(new URL(url).protocol) } catch { ok = false }
    if (!ok) event.preventDefault()
  })
  return win
```

- [ ] **Step 3: Проверка**

Run: `npm run typecheck` и `npm test`
Expected: компиляция; тесты проходят (включая `tests/browser-fetch.test.ts`, если он мокает electron).

- [ ] **Step 4: Ручной smoke** — открыть галерею nhentai с включённым Tor/проверкой Cloudflare: окно по-прежнему появляется и умеет пройти капчу, stealth-скрипт работает.

- [ ] **Step 5: Commit** (спросить пользователя)

---

### Task A3: Закалка окон логина и Google OAuth

**Files:**
- Modify: `src/main/services/login.ts`
- Modify: `src/main/services/google-auth.ts`

**Interfaces:**
- Consumes: `denyAllPermissions` из `src/main/security.ts`.

- [ ] **Step 1: `src/main/services/login.ts`**

- Импорт: `import { denyAllPermissions } from './security'`.
- В `webPreferences` добавить `sandbox: true`.
- После создания окна: `denyAllPermissions(ses)`.
- В `setWindowOpenHandler` ограничить схему:

```ts
    win.webContents.setWindowOpenHandler((details) => {
      dlog(`window-open -> ${details.url}`)
      let ok = false
      try { ok = /^https?:$/.test(new URL(details.url).protocol) } catch { ok = false }
      if (!ok) return { action: 'deny' }
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 900, height: 700 } }
    })
    win.webContents.on('will-navigate', (event, url) => {
      let ok = false
      try { ok = /^https?:$/.test(new URL(url).protocol) } catch { ok = false }
      if (!ok) event.preventDefault()
    })
```

- [ ] **Step 2: `src/main/services/google-auth.ts`**

- Импорт: `import { session, BrowserWindow, safeStorage } from 'electron'` и `import { denyAllPermissions } from './security'`.
- В `captureCode()` перед созданием окна:
```ts
        denyAllPermissions(session.fromPartition('persist:google-oauth'))
        win = new BrowserWindow({
          width: 520, height: 720, title: 'Вход через Google', autoHideMenuBar: true,
          webPreferences: {
            partition: 'persist:google-oauth',
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        })
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        win.webContents.on('will-navigate', (event, url) => {
          let ok = false
          try {
            const u = new URL(url)
            ok = u.hostname === 'accounts.google.com' || u.hostname === '127.0.0.1' || u.hostname === 'localhost'
          } catch { ok = false }
          if (!ok) event.preventDefault()
        })
```

- [ ] **Step 3: Проверка**

Run: `npm run typecheck` и `npm test`
Expected: компиляция; тесты проходят.

- [ ] **Step 4: Ручной smoke** — вход в E-Hentai/nhentai через логин-окно (OAuth-попап senkuro работает); вход Google открывает accounts.google.com.

- [ ] **Step 5: Commit** (спросить пользователя)

---

### Task A4: zod-валидация опасных IPC-хендлеров

**Files:**
- Modify: `package.json` (добавить `zod`)
- Create: `src/main/ipc/validate.ts`
- Modify: `src/main/index.ts` (заменить 7 хендлеров)
- Test: `tests/ipc-validate.test.ts`

**Interfaces:**
- Produces:
  - `existingDirOrArchive: ZodType<string>`
  - `httpUrl: ZodType<string>`
  - `dlTypeToken: ZodType<string>`
  - `handleSafe(channel, schema, handler)` — обёртка `ipcMain.handle` с валидацией; при невалидных аргументах бросает `Error`.

- [ ] **Step 1: Установить zod**

Run: `npm install zod@^3`
Expected: `package.json` получает `"zod": "^3.xx"`.

- [ ] **Step 2: Создать `src/main/ipc/validate.ts`**

```ts
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z, type ZodType } from 'zod'
import { existsSync, statSync } from 'fs'
import { isAbsolute } from 'path'

const noNul = z.string().min(1).max(4096).refine((p) => !p.includes('\0'), 'путь содержит NUL')
const `absolute` = noNul.refine((p) => isAbsolute(p), 'путь должен быть абсолютным')

/** Существующая папка либо .zip/.cbz-файл. */
export const existingDirOrArchive: ZodType<string> = absolute.refine((p) => {
  if (!existsSync(p)) return false
  try {
    const st = statSync(p)
    if (st.isDirectory()) return true
    return st.isFile() && /\.(zip|cbz)$/i.test(p)
  } catch { return false }
}, 'путь должен быть существующей папкой или .zip/.cbz файлом')

/** http/https URL. */
export const httpUrl: ZodType<string> = z.string().min(1).max(8192).refine((u) => {
  try { return /^https?:$/.test(new URL(u).protocol) } catch { return false }
}, 'URL должен быть http(s)')

/** Короткий токен dltype EH-архива (значения приходят с сайта: org/resample/…). */
export const dlTypeToken: ZodType<string> = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'некорректный dltype')

/** Обёртка ipcMain.handle с валидацией аргументов до вызова обработчика. */
export function handleSafe<T extends unknown[]>(
  channel: string,
  schema: ZodType<T>,
  handler: (event: IpcMainInvokeEvent, ...args: T) => unknown
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    const parsed = schema.safeParse(args)
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ')
      throw new Error(`Недопустимые аргументы для ${channel}: ${detail}`)
    }
    return handler(event, ...(parsed.data as T))
  })
}
```

(Исправить опечатку в коде: вместо `` `absolute` `` использовать имя `absolutePath` — см. шаг 3.)

- [ ] **Step 3: Исправить имя переменной в `validate.ts`**

В файле заменить `` const `absolute` = `` на `const absolutePath =` и `absolute.refine` на `absolutePath.refine`.

- [ ] **Step 4: Написать тест `tests/ipc-validate.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { existingDirOrArchive, httpUrl, dlTypeToken } from '../src/main/ipc/validate'

describe('ipc-validate schemas', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ipcval-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('existingDirOrArchive accepts a real folder', () => {
    expect(existingDirOrArchive.safeParse(dir).success).toBe(true)
  })
  it('existingDirOrArchive accepts an existing .zip file', () => {
    const zip = join(dir, 'a.zip')
    writeFileSync(zip, 'x')
    expect(existingDirOrArchive.safeParse(zip).success).toBe(true)
  })
  it('existingDirOrArchive rejects missing/relative/non-archive', () => {
    expect(existingDirOrArchive.safeParse(join(dir, 'nope')).success).toBe(false)
    expect(existingDirOrArchive.safeParse('relative/path').success).toBe(false)
    const txt = join(dir, 'a.txt')
    writeFileSync(txt, 'x')
    expect(existingDirOrArchive.safeParse(txt).success).toBe(false)
    expect(existingDirOrArchive.safeParse(42).success).toBe(false)
    expect(existingDirOrArchive.safeParse(`a\0b`).success).toBe(false)
  })
  it('httpUrl accepts http/https and rejects others', () => {
    expect(httpUrl.safeParse('https://exhentai.org/').success).toBe(true)
    expect(httpUrl.safeParse('http://127.0.0.1:9150/').success).toBe(true)
    expect(httpUrl.safeParse('file:///etc/passwd').success).toBe(false)
    expect(httpUrl.safeParse('javascript:alert(1)').success).toBe(false)
    expect(httpUrl.safeParse('data:text/html,x').success).toBe(false)
  })
  it('dlTypeToken accepts sane tokens', () => {
    expect(dlTypeToken.safeParse('org').success).toBe(true)
    expect(dlTypeToken.safeParse('resample').success).toBe(true)
    expect(dlTypeToken.safeParse('x y').success).toBe(false)
    expect(dlTypeToken.safeParse('').success).toBe(false)
  })
})
```

Обратите внимание: `validate.ts` импортирует `electron` (`ipcMain`, `IpcMainInvokeEvent`). Тест импортирует схемы из этого модуля → **тест обязан мокать electron**:

- [ ] **Step 5: Добавить `vi.mock('electron')` в начало теста**

В `tests/ipc-validate.test.ts` первой строкой (после импорта vitest):

```ts
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))
```

и импортировать `vi` из `vitest`.

- [ ] **Step 6: Запустить тест**

Run: `npx vitest run tests/ipc-validate.test.ts`
Expected: все проверки проходят.

- [ ] **Step 7: Подключить валидацию в `src/main/index.ts`**

Заменить следующие 7 хендлеров (внутренний код хендлеров не меняется, меняется только обёртка):

```ts
  ipcMain.handle(CH.openFolder, (_e, path: string) => openFolder(path))
  ipcMain.handle(CH.rescanFolder, (_e, path: string) => {
    const g = galleryFromFolder(path)
    if (!g) return null
    galleries.set(g.id, g)
    return { id: g.id, title: g.title, pageCount: g.pages.length, pages: g.pages, url: `file://${path}` }
  })
```
→
```ts
  handleSafe(CH.openFolder, z.tuple([existingDirOrArchive]), (_e, path) => openFolder(path))
  handleSafe(CH.rescanFolder, z.tuple([existingDirOrArchive]), (_e, path) => {
    const g = galleryFromFolder(path)
    if (!g) return null
    galleries.set(g.id, g)
    return { id: g.id, title: g.title, pageCount: g.pages.length, pages: g.pages, url: `file://${path}` }
  })
```

```ts
    ipcMain.handle(CH.openUrl, async (_e, url: string, startPage?: number, mangaId?: string | null, coverUrl?: string | null, kind?: string | null) => {
```
→
```ts
    handleSafe(CH.openUrl, z.tuple([
      httpUrl,
      z.number().int().min(0).optional(),
      z.union([z.string(), z.null()]).optional(),
      z.union([z.string(), z.null()]).optional(),
      z.union([z.string(), z.null()]).optional()
    ]), async (_e, url, startPage, mangaId, coverUrl, kind) => {
```
(тело хендлера `openUrl` остаётся нетронутым, включая `const trimmed = url.trim()` и далее до закрывающей скобки).

```ts
  ipcMain.handle(CH.downloadsAdd, async (_e, sourceUrl: string) => {
```
→
```ts
  handleSafe(CH.downloadsAdd, z.tuple([httpUrl]), async (_e, sourceUrl) => {
```

```ts
  ipcMain.handle(CH.downloadsAddArchive, (_e, sourceUrl: string, title: string, downloadUrl: string) => {
```
→
```ts
  handleSafe(CH.downloadsAddArchive, z.tuple([httpUrl, z.string().min(1).max(512), httpUrl]), (_e, sourceUrl, title, downloadUrl) => {
```

```ts
  ipcMain.handle(CH.ehArchiveCost, async (_e, url: string) => {
```
→
```ts
  handleSafe(CH.ehArchiveCost, z.tuple([httpUrl]), async (_e, url) => {
```

```ts
  ipcMain.handle(CH.ehArchiveBuy, async (_e, url: string, dltype: string) => {
```
→
```ts
  handleSafe(CH.ehArchiveBuy, z.tuple([httpUrl, dlTypeToken]), async (_e, url, dltype) => {
```

Добавить в начало файла `index.ts`:

```ts
import { z } from 'zod'
import { handleSafe, existingDirOrArchive, httpUrl, dlTypeToken } from './ipc/validate'
```

Убрать/заменить неиспользуемые после правок переменные, если появятся предупреждения TS.

- [ ] **Step 8: Проверка**

Run: `npm run typecheck` и `npm test`
Expected: компиляция без ошибок; все тесты проходят (включая новый `ipc-validate`).

- [ ] **Step 9: Ручной smoke** — открытие локальной папки (папка и `.zip` работают), `openUrl` галереи из каталога работает; попытка вызвать `openFolder` с несуществующим путём возвращает ошибку.

- [ ] **Step 10: Commit** (спросить пользователя)

---

### Task B1: PIN на scrypt + миграция legacy

**Files:**
- Modify: `src/main/services/pin.ts`
- Test: `tests/pin.test.ts` (добавить кейсы)

**Interfaces:**
- Produces (без изменения сигнатур):
  - `makePinRecord(pin: string, salt: string): PinStore` — теперь `{ v: 2, algo: 'scrypt', salt, hash }`.
  - `verifyPin(record: PinStore, pin: string): boolean` — scrypt или legacy SHA-256.
  - `PinService.verify` — при успешной проверке legacy-записи переписывает файл в scrypt.

- [ ] **Step 1: Заменить `src/main/services/pin.ts`**

```ts
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

export interface PinStore { v?: number; algo?: 'scrypt'; salt: string; hash: string }

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32

function scryptHash(pin: string, salt: string): string {
  return scryptSync(pin, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString('hex')
}

export function makePinRecord(pin: string, salt: string): PinStore {
  return { v: 2, algo: 'scrypt', salt, hash: scryptHash(pin, salt) }
}

export function verifyPin(record: PinStore, pin: string): boolean {
  if (record.algo === 'scrypt') {
    try {
      const expected = Buffer.from(record.hash, 'hex')
      const actual = scryptSync(pin, record.salt, expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
      return expected.length === actual.length && timingSafeEqual(expected, actual)
    } catch {
      return false
    }
  }
  // legacy: SHA-256 в один проход (существующие установки)
  const legacy = createHash('sha256').update(record.salt + pin).digest('hex')
  return legacy === record.hash
}

const PIN_RE = /^\d{4,8}$/

export class PinService {
  private path: string
  private fails = 0
  private lockUntil = 0

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'pin.json')
  }

  private load(): PinStore | null {
    if (!existsSync(this.path)) return null
    try { return JSON.parse(readFileSync(this.path, 'utf-8')) as PinStore } catch { return null }
  }

  hasPin(): boolean { return this.load() !== null }

  setPin(pin: string): void {
    if (!PIN_RE.test(pin)) throw new Error('PIN должен быть 4–8 цифр')
    writeFileSync(this.path, JSON.stringify(makePinRecord(pin, randomBytes(16).toString('hex')), null, 2))
    this.fails = 0
    this.lockUntil = 0
  }

  removePin(pin: string): boolean {
    const rec = this.load()
    if (!rec || !verifyPin(rec, pin)) return false
    try { rmSync(this.path) } catch { /* ignore */ }
    return true
  }

  verify(pin: string): boolean {
    const rec = this.load()
    if (!rec) return true // no pin set
    if (Date.now() < this.lockUntil) return false
    const ok = verifyPin(rec, pin)
    if (ok) {
      this.fails = 0
      this.lockUntil = 0
      if (rec.algo !== 'scrypt') this.upgradeToScrypt(pin)
      return true
    }
    this.fails++
    if (this.fails >= 3) {
      this.lockUntil = Date.now() + 30_000
      this.fails = 0
    }
    return false
  }

  private upgradeToScrypt(pin: string): void {
    try {
      writeFileSync(this.path, JSON.stringify(makePinRecord(pin, randomBytes(16).toString('hex')), null, 2))
    } catch { /* leave legacy record */ }
  }

  failedAttempt(): { locked: boolean; retryAfterSec: number } {
    if (Date.now() < this.lockUntil) {
      return { locked: true, retryAfterSec: Math.max(1, Math.ceil((this.lockUntil - Date.now()) / 1000)) }
    }
    return { locked: false, retryAfterSec: 0 }
  }
}
```

- [ ] **Step 2: Добавить тесты в `tests/pin.test.ts`**

Импорты: `createHash` из `crypto`, `readFileSync`, `writeFileSync` из `fs`. Добавить два `it`-блока:

```ts
  it('verifyPin accepts legacy sha256 records', () => {
    const rec = { salt: 's', hash: createHash('sha256').update('s' + '4321').digest('hex') }
    expect(verifyPin(rec, '4321')).toBe(true)
    expect(verifyPin(rec, '0000')).toBe(false)
  })

  it('PinService upgrades legacy hash to scrypt on successful verify', () => {
    const rec = { salt: 's', hash: createHash('sha256').update('s' + '4321').digest('hex') }
    writeFileSync(join(dir, 'pin.json'), JSON.stringify(rec))
    const s = new PinService(dir)
    expect(s.verify('4321')).toBe(true)
    const reloaded = JSON.parse(readFileSync(join(dir, 'pin.json'), 'utf8')) as { algo?: string }
    expect(reloaded.algo).toBe('scrypt')
    expect(new PinService(dir).verify('4321')).toBe(true)
  })
```

- [ ] **Step 3: Запустить тесты**

Run: `npx vitest run tests/pin.test.ts`
Expected: все существующие и новые кейсы проходят. (Обратите внимание: `makePinRecord('1234','salt')` теперь scrypt — существующий round-trip тест продолжает работать.)

- [ ] **Step 4: Проверка typecheck**

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Step 5: Commit** (спросить пользователя)

---

### Task B2: secret-box + шифрование cookie-полей в SettingsService

**Files:**
- Create: `src/main/services/secret-box.ts`
- Modify: `src/main/services/settings.ts`
- Test: `tests/secret-box.test.ts`, `tests/settings-service.test.ts`

**Interfaces:**
- Produces:
  - `isEncrypted(v: string): boolean`
  - `encryptSecret(plain: string): string | null` — `'enc:v1:'+base64`, `''` остаётся `''`, `null` при недоступности safeStorage.
  - `decryptSecret(stored: string): string`
- Consumes: `SettingsService.save(s)` больше не пишет cookie-поля плейнтекстом (если шифрование доступно).

- [ ] **Step 1: Создать `src/main/services/secret-box.ts`**

```ts
import { safeStorage } from 'electron'

const PREFIX = 'enc:v1:'

export function isEncrypted(v: string): boolean {
  return v.startsWith(PREFIX)
}

/** Возвращает зашифрованный текст с префиксом; '' остаётся ''; null — шифрование недоступно. */
export function encryptSecret(plain: string): string | null {
  if (plain === '') return plain
  if (!safeStorage.isEncryptionAvailable()) return null
  try { return PREFIX + safeStorage.encryptString(plain).toString('base64') } catch { return null }
}

/** Расшифровывает; legacy-плейнтекст возвращает как есть; битый шифртекст → ''. */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64')
    return safeStorage.decryptString(raw)
  } catch {
    console.warn('[secret-box] не удалось расшифровать секрет — сброс значения')
    return ''
  }
}
```

- [ ] **Step 2: Модифицировать `src/main/services/settings.ts`**

Добавить импорт `import { isEncrypted, encryptSecret, decryptSecret } from './secret-box'`. Константа и новые read/save:

```ts
const SECRET_FIELDS = ['onion_cookies_raw', 'nhentai_cookies_raw', 'senkuro_cookies_raw', 'nhentai_onion_cookies_raw'] as const
```

```ts
  private read(): Settings {
    if (!existsSync(this.path)) return defaultSettings()
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, unknown>
      for (const k of SECRET_FIELDS) {
        if (typeof raw[k] === 'string') raw[k] = decryptSecret(raw[k] as string)
      }
      const s = parseSettings(raw)
      this.needsSecretRewrite = SECRET_FIELDS.some((k) => {
        const v = raw[k]
        return typeof v === 'string' && v !== '' && !isEncrypted(v)
      })
      return s
    } catch {
      return defaultSettings()
    }
  }

  save(s: Settings): void {
    this.current = s
    const out = { ...s } as Record<string, unknown>
    for (const k of SECRET_FIELDS) {
      const v = (s as unknown as Record<string, string>)[k] ?? ''
      const enc = encryptSecret(v)
      out[k] = enc !== null ? enc : v
    }
    mkdirSync(join(this.path, '..'), { recursive: true })
    writeFileSync(this.path, JSON.stringify(out, null, 2), 'utf8')
  }
```

В класс добавить поле `private needsSecretRewrite = false` и после `this.current = this.read()` в конструкторе:

```ts
    if (this.needsSecretRewrite) this.save(this.current)
```

(Примечание: перезапись происходит только если на диске был legacy-плейнтекст секрета и шифрование доступно — внутри `save` он всё равно пойдёт через `encryptSecret`.)

- [ ] **Step 3: Написать `tests/secret-box.test.ts`**

Обязателен `vi.mock('electron', …)`, чтобы `safeStorage` был фейком:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc(${s})`)),
    decryptString: vi.fn((b: Buffer) => b.toString('utf8').replace(/^enc\((.*)\)$/, '$1'))
  }
}))

import { isEncrypted, encryptSecret, decryptSecret } from '../src/main/services/secret-box'
import { safeStorage } from 'electron'

describe('secret-box', () => {
  beforeEach(() => {
    (safeStorage.isEncryptionAvailable as any).mockReturnValue(true)
  })
  it('round-trips through encrypt/decrypt', () => {
    const enc = encryptSecret('hello')
    expect(isEncrypted(enc!)).toBe(true)
    expect(decryptSecret(enc!)).toBe('hello')
  })
  it('empty string stays empty', () => {
    expect(encryptSecret('')).toBe('')
  })
  it('legacy plaintext passes through decrypt', () => {
    expect(decryptSecret('ipb_pass_hash=abc')).toBe('ipb_pass_hash=abc')
    expect(decryptSecret('')).toBe('')
  })
  it('returns null when encryption unavailable', () => {
    (safeStorage.isEncryptionAvailable as any).mockReturnValue(false)
    expect(encryptSecret('x')).toBeNull()
  })
  it('garbage ciphertext decrypts to empty string', () => {
    expect(decryptSecret('enc:v1:!!!not-base64!!!')).toBe('')
  })
})
```

- [ ] **Step 4: Написать `tests/settings-service.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc(${s})`)),
    decryptString: vi.fn((b: Buffer) => b.toString('utf8').replace(/^enc\((.*)\)$/, '$1'))
  }
}))

import { SettingsService } from '../src/main/services/settings'
import { defaultSettings } from '../src/shared/settings'

describe('SettingsService secret-at-rest', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'setsvc-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('save encrypts cookie fields on disk, get returns plaintext', () => {
    const svc = new SettingsService(dir)
    const s = { ...defaultSettings(), onion_cookies_raw: 'ipb_pass_hash=abc' }
    svc.save(s)
    const disk = readFileSync(join(dir, 'settings.json'), 'utf8')
    expect(disk).toContain('enc:v1:')
    expect(disk).not.toContain('ipb_pass_hash=abc')
    const svc2 = new SettingsService(dir)
    expect(svc2.get().onion_cookies_raw).toBe('ipb_pass_hash=abc')
  })

  it('migrates legacy plaintext cookie fields to encrypted on first save', () => {
    const legacy = { ...defaultSettings(), nhentai_cookies_raw: 'nw=1' }
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(legacy))
    const svc = new SettingsService(dir)
    // constructor re-saves because legacy plaintext secret detected
    const disk = readFileSync(join(dir, 'settings.json'), 'utf8')
    expect(disk).toContain('enc:v1:')
    expect(svc.get().nhentai_cookies_raw).toBe('nw=1')
  })
})
```

Примечание: `SettingsService` тянет `secret-box` → `electron`, поэтому тест мокает `safeStorage`.

- [ ] **Step 5: Запустить новые тесты**

Run: `npx vitest run tests/secret-box.test.ts tests/settings-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Проверка typecheck и полного прогона**

Run: `npm run typecheck` и `npm test`
Expected: компиляция; все тесты проходят. (Модуль `settings.ts` теперь тянет electron — существующие тесты его не импортируют, среда не ломается.)

- [ ] **Step 7: Ручной smoke** — изменить любую настройку в UI: `settings.json` на диске содержит `enc:v1:` в cookie-полях, приложение читает их корректно (вход в каталог работает).

- [ ] **Step 8: Commit** (спросить пользователя)

---

### Task B3: safeStorage для портфеля аккаунтов E-Hentai

**Files:**
- Modify: `src/main/services/accounts.ts`
- Test: `tests/accounts-secret.test.ts`

**Interfaces:**
- Consumes: `isEncrypted`, `encryptSecret`, `decryptSecret` из `secret-box`.
- Produces: `loadManualAccounts`/`saveManualAccounts` работают с зашифрованным `eh_accounts.json` и читают legacy-плейнтекст.

- [ ] **Step 1: Модифицировать `src/main/services/accounts.ts`**

Добавить импорт `import { isEncrypted, encryptSecret, decryptSecret } from './secret-box'`. Заменить:

```ts
export function loadManualAccounts(userDataDir: string): ExAccount[] {
  const p = manualAccountsPath(userDataDir)
  if (!existsSync(p)) return []
  try {
    const stored = JSON.parse(readFileSync(p, 'utf-8')) as StoredAccount[]
    return stored.map((s, i) => ({ id: i + 1, name: s.name, cookies: s.cookies }))
  } catch {
    return []
  }
}

export function saveManualAccounts(userDataDir: string, accounts: ExAccount[]): void {
  const stored: StoredAccount[] = accounts.map((a) => ({ name: a.name, cookies: a.cookies }))
  try {
    writeFileSync(manualAccountsPath(userDataDir), JSON.stringify(stored, null, 2))
  } catch { /* ignore */ }
}
```

на:

```ts
export function loadManualAccounts(userDataDir: string): ExAccount[] {
  const p = manualAccountsPath(userDataDir)
  if (!existsSync(p)) return []
  try {
    const text = readFileSync(p, 'utf-8')
    const json = isEncrypted(text) ? decryptSecret(text) : text
    const stored = JSON.parse(json) as StoredAccount[]
    return stored.map((s, i) => ({ id: i + 1, name: s.name, cookies: s.cookies }))
  } catch {
    return []
  }
}

export function saveManualAccounts(userDataDir: string, accounts: ExAccount[]): void {
  const stored: StoredAccount[] = accounts.map((a) => ({ name: a.name, cookies: a.cookies }))
  try {
    const plain = JSON.stringify(stored, null, 2)
    const enc = encryptSecret(plain)
    writeFileSync(manualAccountsPath(userDataDir), enc !== null ? enc : plain)
  } catch { /* ignore */ }
}
```

- [ ] **Step 2: Написать `tests/accounts-secret.test.ts`**

Модуль `accounts.ts` импортирует `app` из electron и `secret-box`. Мокаем всё:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc(${s})`)),
    decryptString: vi.fn((b: Buffer) => b.toString('utf8').replace(/^enc\((.*)\)$/, '$1'))
  }
}))

import { loadManualAccounts, saveManualAccounts } from '../src/main/services/accounts'

describe('eh_accounts.json at rest', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'accts-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('round-trips save/load through encryption', () => {
    saveManualAccounts(dir, [{ id: 1, name: 'A', cookies: [['ipb_pass_hash', 'abc'], ['igneous', 'xyz']] }])
    const disk = readFileSync(join(dir, 'eh_accounts.json'), 'utf8')
    expect(disk.startsWith('enc:v1:')).toBe(true)
    expect(disk).not.toContain('abc')
    const loaded = loadManualAccounts(dir)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].cookies).toEqual([['ipb_pass_hash', 'abc'], ['igneous', 'xyz']])
  })

  it('loads legacy plaintext file', () => {
    writeFileSync(join(dir, 'eh_accounts.json'), JSON.stringify([{ name: 'A', cookies: [['igneous', 'val']] }]))
    const loaded = loadManualAccounts(dir)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].cookies).toEqual([['igneous', 'val']])
  })

  it('returns empty on corrupted data', () => {
    writeFileSync(join(dir, 'eh_accounts.json'), 'enc:v1:!!!!')
    expect(loadManualAccounts(dir)).toEqual([])
  })
})
```

- [ ] **Step 3: Запустить тест**

Run: `npx vitest run tests/accounts-secret.test.ts`
Expected: PASS.

- [ ] **Step 4: Проверка typecheck и полного прогона**

Run: `npm run typecheck` и `npm test`
Expected: компиляция; все тесты проходят (`tests/accounts-parse.test.ts` не задет).

- [ ] **Step 5: Ручной smoke** — добавить аккаунт E-Hentai в настройках: `eh_accounts.json` на диске содержит `enc:v1:`, каталог E-Hentai работает с этими куками.

- [ ] **Step 6: Commit** (спросить пользователя)

---

### Task B4: Google-client secret из env + `configured`

**Files:**
- Modify: `electron.vite.config.ts`
- Modify: `vitest.config.ts`
- Modify: `src/main/services/google-config.ts`
- Modify: `src/main/services/google-auth.ts`
- Modify: `src/shared/ipc.ts` (тип `GoogleAuthStatus`)
- Modify: `src/renderer/src/screens/Settings.tsx`

**Interfaces:**
- Produces: `GOOGLE_CLIENT_SECRET` — пустая строка при отсутствии env; `GoogleAuthStatus.configured?: boolean`; `login()`/`getAccessToken()` бросают при пустом секрете.

- [ ] **Step 1: `electron.vite.config.ts`**

```ts
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    define: { __GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.GOOGLE_CLIENT_SECRET ?? '') }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  }
})
```

- [ ] **Step 2: `vitest.config.ts`**

```ts
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  define: { __GOOGLE_CLIENT_SECRET__: "''" },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
})
```

- [ ] **Step 3: `src/main/services/google-config.ts`**

Заменить первые строки:

```ts
declare const __GOOGLE_CLIENT_SECRET__: string | undefined

export const GOOGLE_CLIENT_ID = '59705917238-2tditham9qpns2gl7tecarqh77krg5bt.apps.googleusercontent.com'
// The secret for a desktop OAuth client is not confidential to Google, but it
// must not sit in a public repo (anyone could impersonate the app). Injected
// at build time from GOOGLE_CLIENT_SECRET; empty → Google sign-in is disabled.
export const GOOGLE_CLIENT_SECRET = typeof __GOOGLE_CLIENT_SECRET__ === 'string' ? __GOOGLE_CLIENT_SECRET__ : ''
export const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/drive.appdata'
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
export const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo'
```

- [ ] **Step 4: `src/main/services/google-auth.ts`**

- В `status()`:
```ts
  status(): { authed: boolean; email: string | null; configured: boolean } {
    return { authed: !!this.tokens?.refresh_token, email: this.tokens?.email ?? null, configured: !!GOOGLE_CLIENT_SECRET }
  }
```
- В `login()` первой строкой:
```ts
    if (!GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET не задан при сборке — вход через Google недоступен')
```
- В `getAccessToken()` в начале (перед обращением к токенам):
```ts
    if (!GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET не задан при сборке — обновление токена Google недоступно')
```

- [ ] **Step 5: `src/shared/ipc.ts` — тип**

```ts
export interface GoogleAuthStatus { authed: boolean; email: string | null; configured?: boolean }
```

- [ ] **Step 6: `src/renderer/src/screens/Settings.tsx`**

- Строка 73 (состояние):
```tsx
  const [google, setGoogle] = useState<{ authed: boolean; email: string | null; configured?: boolean }>({ authed: false, email: null })
```
- Кнопка «Войти через Google» (строка 366):
```tsx
                <button disabled={google.configured === false} onClick={async () => {
                  setSyncMsg('Открываю окно входа Google…')
                  try { const r = await window.api.googleLogin(); setGoogle(r); setSyncMsg('Вход выполнен') }
                  catch (e: any) { setSyncMsg(`Ошибка: ${e?.message ?? e}`) }
                }}>Войти через Google</button>
```
- Под кнопкой добавить:
```tsx
              {google.configured === false && <div className="row muted">Google-вход отключён: GOOGLE_CLIENT_SECRET не задан при сборке.</div>}
```

- [ ] **Step 7: Проверка**

Run: `npm run typecheck` и `npm test`
Expected: компиляция; `tests/google-auth.test.ts` проходит (модуль грузится: `typeof`-guard защищает от `ReferenceError`, `configured` не обязателен).

- [ ] **Step 8: Ручной smoke** — собрать без env: кнопка Google задизейблена, статус `configured: false`. С `$env:GOOGLE_CLIENT_SECRET='x'; npm run dev` — кнопка активна.

- [ ] **Step 9: Commit** (спросить пользователя)

---

### Task B5: Документация и финальная проверка

**Files:**
- Modify: `README.md` (если есть; иначе пропустить)
- Verify: полный прогон

- [ ] **Step 1: Обновить README (секция сборки)**

Добавить:
```md
## Сборка Google-синхронизации
`GOOGLE_CLIENT_SECRET` должен быть задан в окружении при сборке/dev (иначе вход
через Google отключён). После публикации старого client_secret в git его нужно
перевыпустить в Google Cloud Console (OAuth clients → создать новый Desktop client).
```

- [ ] **Step 2: Полный прогон**

Run: `npm run typecheck` и `npm test`
Expected: компиляция без ошибок, все тесты зелёные.

- [ ] **Step 3: Финальный ручной smoke**
  - Главное окно: CSP-заголовок в DevTools (Network → ответ документа), картинки грузятся.
  - PIN: установить заново (scrypt), проверить lockout.
  - Вход в каталог (куки читаются после шифрования settings.json/eh_accounts.json).
  - Открытие `.zip`/папки через валидацию.

- [ ] **Step 4: Commit** (спросить пользователя)

---

## Self-Review

**Покрытие спеки:**
- A1 → главное окно, webPreferences, window-open/will-navigate/will-attach, CSP, permission handler (default-deny + clipboard allowlist).
- A2 → browser-fetch окно (nodeIntegration:false, sandbox:true, deny, https-only nav).
- A3 → login и Google-OAuth окна.
- A4 → zod на openFolder/rescanFolder/openUrl/downloadsAdd/downloadsAddArchive/ehArchiveCost/Buy.
- B1 → PIN scrypt + миграция legacy.
- B2 → SettingsService cookie-поля через secret-box + миграция.
- B3 → eh_accounts.json через secret-box.
- B4 → GOOGLE_CLIENT_SECRET из env (без fallback), `configured` в статусе, guards в login/getAccessToken.

**Согласованность типов:** `handleSafe` использует `ZodType<unknown[]>`; схемы — `z.tuple`; `GoogleAuthStatus.configured` опционален; `GOOGLE_CLIENT_SECRET` всегда строка.

**Замечания к реализации:**
- В Task A4 Step 2 содержится осознанная опечатка (имя `` `absolute` ``), которую Step 3 исправляет на `absolutePath` — это часть задачи, не пропускать.
- `installAppCsp` использует ленивый `require('electron')`, чтобы `security.ts` оставался импортируемым в тестах без electron.