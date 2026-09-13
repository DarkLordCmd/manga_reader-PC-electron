import { app, BrowserWindow, session } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { detectsAntiBot } from './anti-bot'

export { detectsAntiBot }

export interface BrowserFetchResult { html: string }

const PARTITION = 'persist:browsing'
const ALLOWED_RESOURCE_TYPES = ['document', 'stylesheet', 'script', 'xhr', 'fetch', 'other']

const STEALTH_JS = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.__proto__.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);
  const nativeToString = Function.prototype.toString;
  Function.prototype.toString = function () {
    if (this === window.navigator.permissions.query) return 'function query() { [native code] }';
    return nativeToString.call(this);
  };
`

let win: BrowserWindow | null = null
let ses: Electron.Session | null = null
let currentProxy = ''
let chain: Promise<unknown> = Promise.resolve()

function prepareSession(): Electron.Session {
  if (ses) return ses
  const s = session.fromPartition(PARTITION, { cache: false })
  s.webRequest.onBeforeRequest((details, callback) => {
    const allow = ALLOWED_RESOURCE_TYPES.includes(details.resourceType)
    callback({ cancel: !allow })
  })
  ses = s
  return s
}

async function applyProxy(s: Electron.Session, proxyKey: string): Promise<void> {
  if (proxyKey) await s.setProxy({ proxyRules: proxyKey })
  else await s.setProxy({ mode: 'direct' })
}

async function ensureBrowser(proxy?: string): Promise<BrowserWindow> {
  const proxyKey = proxy?.trim() ?? ''
  const s = prepareSession()
  if (win && !win.isDestroyed()) {
    if (proxyKey !== currentProxy) {
      currentProxy = proxyKey
      await applyProxy(s, proxyKey)
    }
    return win
  }
  currentProxy = proxyKey
  await applyProxy(s, proxyKey)
  const preloadPath = join(app.getPath('temp'), 'gagl-stealth.js')
  try { writeFileSync(preloadPath, STEALTH_JS) } catch { /* fall back to no preload */ }
  win = new BrowserWindow({
    show: false, width: 1024, height: 768,
    webPreferences: {
      session: s,
      javascript: true, images: false, webSecurity: true,
      contextIsolation: false,
      preload: preloadPath
    }
  })
  return win
}

async function loadViaWindow(url: string, proxy: string | undefined, timeoutMs: number): Promise<string> {
  const w = await ensureBrowser(proxy)
  return await new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      finish(() => {
        reject(new Error('Не удалось загрузить страницу через встроенный браузер: таймаут'))
        void shutdownBrowserFetch()
      })
    }, timeoutMs)
    w.webContents.once('did-finish-load', () => {
      void (async () => {
        try {
          await new Promise((r) => setTimeout(r, 2000))
          const html: string = await w.webContents.executeJavaScript('document.documentElement.outerHTML', true)
          finish(() => resolve(html))
        } catch (e: any) {
          finish(() => reject(new Error(`Не удалось загрузить страницу через встроенный браузер: ${e?.message ?? String(e)}`)))
        }
      })()
    })
    w.webContents.once('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame) return
      finish(() => reject(new Error(`Не удалось загрузить страницу через встроенный браузер: ${code} ${desc}`)))
    })
    void w.loadURL(url).catch(() => {})
  })
}

export async function fetchHtmlViaBrowser(url: string, opts: { proxy?: string; timeoutMs?: number } = {}): Promise<string> {
  const run = chain.then(() => loadViaWindow(url, opts.proxy, opts.timeoutMs ?? 30_000))
  chain = run.catch(() => {})
  return await run
}

export async function shutdownBrowserFetch(): Promise<void> {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
  ses = null
  currentProxy = ''
}
