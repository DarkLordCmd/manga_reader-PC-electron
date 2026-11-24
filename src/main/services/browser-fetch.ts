// Hidden-window scraping channel for anti-bot walls. Electron webRequest
// resource types are ('mainFrame'|'subFrame'|... — NOT the 'document' Chromium
// vocabulary — see ALLOWED_RESOURCE_TYPES below.
import { BrowserWindow, session } from 'electron';
import { detectsAntiBot } from './anti-bot';
import { denyAllPermissions } from '../security';
import { logger } from './logger';

export { detectsAntiBot };

export interface BrowserFetchResult {
  html: string;
}

// Electron webRequest resource-type names (NOT the 'document' Chromium web
// vocabulary): killing the mainFrame by mistake is exactly what produced
// ERR_BLOCKED_BY_CLIENT(-20) on every load. Images are blocked via
// webPreferences.images=false — fonts get through (some CDNs inline checks).
const PARTITION = 'persist:browsing';
// Assets beyond HTML/JS/XHR just slow Tor-based loads (stylesheets/fonts
// were the bulk of a nhentai first navigation) and are not needed for DOM
// scraping. The Cloudflare challenge itself only needs script/XHR frames.
const ALLOWED_RESOURCE_TYPES = ['mainFrame', 'subFrame', 'script', 'xhr', 'fetch', 'serviceworker'];

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
`;

let win: BrowserWindow | null = null;
let ses: Electron.Session | null = null;
let currentProxy = '';
/** ONE lock for the shared window. There used to be two independent chains
 * (navigations vs in-window fetches) over the same BrowserWindow and the same
 * session proxy: one branch could navigate away (destroying the other's JS
 * context → "Script failed to execute"), flip the proxy of a request that was
 * already intended for Tor (IP leak), or resolve a stale `did-finish-load`
 * promise with a different page's HTML. Everything that touches the window now
 * runs exclusively. */
let windowLock: Promise<unknown> = Promise.resolve();

function withWindowLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = windowLock.then(fn, fn);
  windowLock = run.catch(() => {});
  return run;
}

export function prepareSession(): Electron.Session {
  if (ses) return ses;
  const s = session.fromPartition(PARTITION, { cache: false });
  denyAllPermissions(s);
  s.webRequest.onBeforeRequest((details, callback) => {
    const allow = ALLOWED_RESOURCE_TYPES.includes(details.resourceType);
    callback({ cancel: !allow });
  });
  ses = s;
  return s;
}

async function applyProxy(s: Electron.Session, proxyKey: string): Promise<void> {
  if (proxyKey) {
    // Chromium needs an explicit scheme; a bare host:port is treated as an
    // HTTP CONNECT proxy and dies with ERR_TUNNEL_CONNECTION_FAILED on SOCKS.
    const rules = proxyKey
      .replace(/^socks5h:\/\//, 'socks5://')
      .replace(/^socks4:\/\//, 'socks4://')
      .match(/^socks\d:\/\//)
      ? proxyKey.replace(/^socks5h:\/\//, 'socks5://')
      : `socks5://${proxyKey}`;
    await s.setProxy({ proxyRules: rules });
  } else {
    await s.setProxy({ mode: 'direct' });
  }
}

async function ensureBrowser(proxy?: string): Promise<BrowserWindow> {
  const proxyKey = proxy?.trim() ?? '';
  const s = prepareSession();
  if (win && !win.isDestroyed()) {
    if (proxyKey !== currentProxy) {
      currentProxy = proxyKey;
      await applyProxy(s, proxyKey);
    }
    return win;
  }
  currentProxy = proxyKey;
  await applyProxy(s, proxyKey);
  win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: {
      session: s,
      javascript: true,
      images: false,
      webSecurity: true,
      nodeIntegration: false,
      // The stealth patches must run inside the page's own JS context, so they
      // are injected over CDP (`Page.addScriptToEvaluateOnNewDocument`) before
      // the first navigation instead of through a preload with
      // contextIsolation:false. That keeps the isolation model intact and
      // removes the predictable %TEMP%\gagl-stealth.js file (and its TOCTOU
      // window) the old approach relied on.
      contextIsolation: true,
      sandbox: true,
    },
  });
  try {
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: STEALTH_JS });
  } catch (e: any) {
    logger.warn('[browser-fetch] stealth injection unavailable:', e?.message ?? e);
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    let ok = false;
    try {
      ok = /^https?:$/.test(new URL(url).protocol);
    } catch {
      ok = false;
    }
    if (!ok) event.preventDefault();
  });
  return win;
}

async function loadViaWindow(
  url: string,
  proxy: string | undefined,
  timeoutMs: number,
  cookie?: string,
  cookieHost?: string,
): Promise<string> {
  const w = await ensureBrowser(proxy);
  await seedSessionCookies(prepareSession(), cookie, cookieHost);
  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      w.webContents.off('did-finish-load', onFinish);
      w.webContents.off('did-fail-load', onFail);
    };
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        reject(new Error('Не удалось загрузить страницу через встроенный браузер: таймаут'));
        void shutdownBrowserFetch();
      });
    }, timeoutMs);

    // Cloudflare challenges render first, run invisible checks for a few
    // seconds (either in-place or via a reload) and only then show the real
    // page — so poll the DOM until the anti-bot wall is gone or timeout.
    // If the wall persists (interactive Turnstile), the window is shown so
    // the user can complete it manually.
    const onFinish = (): void => {
      let shown = false;
      const wallStart = Date.now();
      void (async () => {
        const deadline = wallStart + Math.max(timeoutMs - 5000, 6000);
        while (Date.now() < deadline && !settled) {
          try {
            const html: string = await w.webContents.executeJavaScript('document.documentElement.outerHTML', true);
            w.setTitle('Через встроенный браузер… (если появится проверка Cloudflare — пройди её)');
            if (!detectsAntiBot(0, html)) {
              finish(() => resolve(html));
              return;
            }
            if (!shown && Date.now() - wallStart > 8000) {
              shown = true;
              w.show();
              w.focus();
            }
            await new Promise((r) => setTimeout(r, 2500));
          } catch (e: any) {
            finish(() => {
              reject(new Error(`Не удалось загрузить страницу через встроенный браузер: ${e?.message ?? String(e)}`));
            });
            return;
          }
        }
      })();
    };
    const onFail = (_e: unknown, code: number, desc: string, _url: string, isMainFrame: boolean): void => {
      if (!isMainFrame || code === -3) return; // -3 = sub-frame abort (captcha iframe)
      finish(() => reject(new Error(`Не удалось загрузить страницу через встроенный браузер: ${code} ${desc}`)));
    };
    // Listeners are registered per call and removed on settle: the old code
    // left a `did-finish-load` listener behind on every failed load, so a later
    // navigation woke all the stale watchers (redundant 2.5 s DOM polling).
    w.webContents.once('did-finish-load', onFinish);
    w.webContents.on('did-fail-load', onFail);
    void w.loadURL(url).catch(() => {});
  });
}

export async function fetchHtmlViaBrowser(
  url: string,
  opts: { proxy?: string; timeoutMs?: number; cookie?: string; cookieHost?: string } = {},
): Promise<string> {
  return await withWindowLock(() => loadViaWindow(url, opts.proxy, opts.timeoutMs ?? 30_000, opts.cookie, opts.cookieHost));
}

/** Attach user-supplied cookies to the browsing session's cookie JAR once.
 * Seeding the jar (instead of rewriting the Cookie header on every request)
 * is essential: the hidden window must be able to rotate session tokens and
 * keep its own `cf_clearance` — a static header override discarded both and
 * kept replaying expired nhentai onion tokens (401 forever).
 * Cookies are re-seeded only when the stored string changes (new login).
 * An explicit empty string logs out by removing only the names seeded here. */
const seededCookieByHost = new Map<string, string>();

export function parseCookiePairs(cookie: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const part of cookie.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (name) pairs.push([name, value]);
  }
  return pairs;
}

export async function seedSessionCookies(s: Electron.Session, cookie: string | undefined, host: string | undefined): Promise<void> {
  if (!host) return;
  const key = host.toLowerCase();
  const previous = seededCookieByHost.get(key);
  const url = `${key.endsWith('.onion') ? 'http' : 'https'}://${key}/`;
  if (cookie !== undefined && !cookie.trim()) {
    if (!previous) return;
    seededCookieByHost.delete(key);
    await Promise.all(
      parseCookiePairs(previous).map(async ([name]) => {
        try {
          await s.cookies.remove(url, name);
        } catch {
          /* invalid cookie name — skip it, keep the rest */
        }
      }),
    );
    return;
  }
  if (!cookie?.trim() || previous === cookie) return;
  seededCookieByHost.set(key, cookie);
  await Promise.all(
    parseCookiePairs(cookie).map(async ([name, value]) => {
      try {
        await s.cookies.set({ url, name, value });
      } catch {
        /* invalid cookie name/value — skip it, keep the rest */
      }
    }),
  );
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
  opts: { proxy?: string; timeoutMs?: number; cookie?: string; cookieHost?: string } = {},
): Promise<{ status: number; text: string }> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  // Everything that touches the shared window runs under one lock (see
  // withWindowLock): the old code had two independent chains, so a navigation
  // could kill this fetch's JS context or switch the session proxy underneath
  // it while the request was in flight.
  return await withWindowLock(async () => {
    const w = await ensureBrowser(opts.proxy);
    await seedSessionCookies(prepareSession(), opts.cookie, opts.cookieHost);
    const origin = new URL(url).origin + '/';
    if (!w.webContents.getURL().startsWith(origin)) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          cleanup();
          reject(new Error('origin load timeout'));
        }, timeoutMs);
        const ok = (): void => {
          clearTimeout(t);
          cleanup();
          resolve();
        };
        const bad = (_e: unknown, code: number, desc: string, _u: string, isMain: boolean): void => {
          if (!isMain) return;
          clearTimeout(t);
          cleanup();
          reject(new Error(`origin load failed: ${code} ${desc}`));
        };
        const cleanup = (): void => {
          w.webContents.off('did-finish-load', ok);
          w.webContents.off('did-fail-load', bad);
        };
        w.webContents.on('did-finish-load', ok);
        w.webContents.on('did-fail-load', bad);
        void w.loadURL(origin).catch((e) => {
          clearTimeout(t);
          cleanup();
          reject(e);
        });
      });
    }
    // In-window fetch with a real deadline. The old code bounded only the
    // origin navigation: a stalled Tor stream then hung the caller (and the UI
    // spinner) until Chromium's multi-minute TCP timeouts.
    const abortKey = `__mrFetchAbort_${Math.random().toString(36).slice(2)}`;
    const expr = `(async () => {
      const ctl = new AbortController();
      window[${JSON.stringify(abortKey)}] = ctl;
      try {
        const r = await fetch(${JSON.stringify(url)}, { credentials: 'include', headers: { 'Accept': 'text/html' }, signal: ctl.signal });
        return { status: r.status, text: await r.text() };
      } finally { window[${JSON.stringify(abortKey)}] = null; }
    })()`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        w.webContents.executeJavaScript(expr, true),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            void w.webContents.executeJavaScript(`window[${JSON.stringify(abortKey)}]?.abort?.()`).catch(() => {});
            reject(new Error('Не удалось загрузить страницу через встроенный браузер: таймаут'));
          }, timeoutMs);
        }),
      ]);
      return result as { status: number; text: string };
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}

/** In-window fetch with a patient retry: nhentai rate-limits bursts of
 * in-window fetches (HTTP 429) — wait briefly and retry once. */
export async function fetchViaWindowFetchRetry(
  url: string,
  opts: { proxy?: string; timeoutMs?: number; cookie?: string; cookieHost?: string } = {},
): Promise<{ status: number; text: string }> {
  const first = await fetchViaWindowFetch(url, opts);
  if (first.status === 429 || first.status === 503) {
    await new Promise((r) => setTimeout(r, 5000));
    return await fetchViaWindowFetch(url, opts);
  }
  return first;
}

export async function shutdownBrowserFetch(): Promise<void> {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
  // The partition itself survives window destruction. Reusing it also keeps
  // the single webRequest hook installed by prepareSession().
  currentProxy = '';
  seededCookieByHost.clear();
}
