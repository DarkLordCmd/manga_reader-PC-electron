// Hidden-window scraping channel for anti-bot walls. Electron webRequest
// resource types are ('mainFrame'|'subFrame'|... — NOT the 'document' Chromium
// vocabulary — see ALLOWED_RESOURCE_TYPES below.
import { app, BrowserWindow, session } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { detectsAntiBot } from './anti-bot'

export { detectsAntiBot }

export interface BrowserFetchResult { html: string }

// Electron webRequest resource-type names (NOT the 'document' Chromium web
// vocabulary): killing the mainFrame by mistake is exactly what produced
// ERR_BLOCKED_BY_CLIENT(-20) on every load. Images are blocked via
// webPreferences.images=false — fonts get through (some CDNs inline checks).
const PARTITION = 'persist:browsing'
// Assets beyond HTML/JS/XHR just slow Tor-based loads (stylesheets/fonts
// were the bulk of a nhentai first navigation) and are not needed for DOM
// scraping. The Cloudflare challenge itself only needs script/XHR frames.
const ALLOWED_RESOURCE_TYPES = ['mainFrame', 'subFrame', 'script', 'xhr', 'fetch', 'serviceworker']

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
let workspaceChain: Promise<unknown> = Promise.resolve()

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
  if (proxyKey) {
    // Chromium needs an explicit scheme; a bare host:port is treated as an
    // HTTP CONNECT proxy and dies with ERR_TUNNEL_CONNECTION_FAILED on SOCKS.
    const rules = proxyKey.replace(/^socks5h:\/\//, 'socks5://').replace(/^socks4:\/\//, 'socks4://')
      .match(/^socks\d:\/\//) ? proxyKey.replace(/^socks5h:\/\//, 'socks5://') : `socks5://${proxyKey}`
    await s.setProxy({ proxyRules: rules })
  } else {
    await s.setProxy({ mode: 'direct' })
  }
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

async function loadViaWindow(
  url: string,
  proxy: string | undefined,
  timeoutMs: number,
  cookie?: string,
  cookieHost?: string
): Promise<string> {
  const w = await ensureBrowser(proxy)
  applySessionCookie(prepareSession(), cookie, cookieHost)
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

    // Cloudflare challenges render first, run invisible checks for a few
    // seconds (either in-place or via a reload) and only then show the real
    // page — so poll the DOM until the anti-bot wall is gone or timeout.
    // If the wall persists (interactive Turnstile), the window is shown so
    // the user can complete it manually.
    w.webContents.once('did-finish-load', () => {
      let shown = false
      const wallStart = Date.now()
      void (async () => {
        const deadline = wallStart + Math.max(timeoutMs - 5000, 6000)
        while (Date.now() < deadline) {
          try {
            const html: string = await w.webContents.executeJavaScript('document.documentElement.outerHTML', true)
            w.setTitle('Через встроенный браузер… (если появится проверка Cloudflare — пройди её)')
            if (!detectsAntiBot(0, html)) {
              finish(() => resolve(html))
              return
            }
            if (!shown && Date.now() - wallStart > 8000) {
              shown = true
              w.show()
              w.focus()
            }
            await new Promise((r) => setTimeout(r, 2500))
          } catch (e: any) {
            finish(() => { reject(new Error(`Не удалось загрузить страницу через встроенный браузер: ${e?.message ?? String(e)}`)) })
            return
          }
        }
      })()
    })
    w.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return // -3 = sub-frame abort (captcha iframe)
      finish(() => reject(new Error(`Не удалось загрузить страницу через встроенный браузер: ${code} ${desc}`)))
    })
    void w.loadURL(url).catch(() => {})
  })
}

export async function fetchHtmlViaBrowser(
  url: string,
  opts: { proxy?: string; timeoutMs?: number; cookie?: string; cookieHost?: string } = {}
): Promise<string> {
  const run = chain.then(() => loadViaWindow(url, opts.proxy, opts.timeoutMs ?? 30_000, opts.cookie, opts.cookieHost))
  chain = run.catch(() => {})
  return await run
}

/** Attach user-supplied cookies to every matching request of the browsing
 * session. The hidden window keeps its own cookie jar — without this hook
 * login-only sources (nhentai onion) get the login page even when valid
 * session cookies are stored in settings. */
function applySessionCookie(s: Electron.Session, cookie: string | undefined, host: string | undefined): void {
  if (!cookie?.trim() || !host) return
  try {
    s.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      const headers = { ...details.requestHeaders }
      if (cookie) headers.Cookie = cookie
      void host
      callback({ requestHeaders: headers })
    })
  } catch { /* keep going without injected cookies */ }
}

/**
 * Browser-grade fetch WITHOUT a page load: the hidden window navigates to
 * the target origin once (cheap), afterwards each URL is fetched from the
 * page context — reusing the session's cookie jar (cf_clearance, login
 * session) and the proxy, without shipping CSS/JS page assets. ~2-4 s via
 * Tor instead of 8-20 s for a full navigation.
 */
export async function fetchViaWindowFetch(
  url: string,
  opts: { proxy?: string; timeoutMs?: number; cookie?: string; cookieHost?: string } = {}
): Promise<{ status: number; text: string }> {
  // Only the window/pairing setup is serialized; the actual in-window fetch
  // runs concurrently so page-count fan-out can hit several items at once.
  const setup = workspaceChain.then(async () => {
    const w = await ensureBrowser(opts.proxy)
    applySessionCookie(prepareSession(), opts.cookie, opts.cookieHost)
    const origin = new URL(url).origin + '/'
    if (!w.webContents.getURL().startsWith(origin)) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { cleanup(); reject(new Error('origin load timeout')) }, opts.timeoutMs ?? 30_000)
        const ok = (): void => { clearTimeout(t); cleanup(); resolve() }
        const bad = (_e: unknown, code: number, desc: string, _u: string, isMain: boolean): void => {
          if (!isMain) return
          clearTimeout(t); cleanup(); reject(new Error(`origin load failed: ${code} ${desc}`))
        }
        const cleanup = (): void => {
          w.webContents.off('did-finish-load', ok)
          w.webContents.off('did-fail-load', bad)
        }
        w.webContents.on('did-finish-load', ok)
        w.webContents.on('did-fail-load', bad)
        void w.loadURL(origin).catch((e) => { clearTimeout(t); cleanup(); reject(e) })
      })
    }
    return w
  })
  workspaceChain = setup.catch(() => {})
  const w = await setup
  return await w.webContents.executeJavaScript(
    `(async () => {
      const r = await fetch(${JSON.stringify(url)}, { credentials: 'include', headers: { 'Accept': 'text/html' } });
      return { status: r.status, text: await r.text() };
    })()`, true
  ) as { status: number; text: string }
}

/** In-window fetch with a patient retry: nhentai rate-limits bursts of
 * in-window fetches (HTTP 429) — wait briefly and retry once. */
export async function fetchViaWindowFetchRetry(
  url: string,
  opts: { proxy?: string; timeoutMs?: number; cookie?: string; cookieHost?: string } = {}
): Promise<{ status: number; text: string }> {
  const first = await fetchViaWindowFetch(url, opts)
  if (first.status === 429 || first.status === 503) {
    await new Promise((r) => setTimeout(r, 5000))
    return await fetchViaWindowFetch(url, opts)
  }
  return first
}

export async function shutdownBrowserFetch(): Promise<void> {  if (win && !win.isDestroyed()) win.destroy()
  win = null
  ses = null
  currentProxy = ''
}
