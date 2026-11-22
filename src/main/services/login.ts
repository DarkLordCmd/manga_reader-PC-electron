import { BrowserWindow, session, app } from 'electron';
import { join } from 'path';
import { requestNewTorCircuit } from './tor-embedded';
import { denyAllPermissions } from '../security';
import { logger } from './logger';
import { isSenkuroHost, senkuroFallbackUrl } from './senkuro-domains';
import {
  SENKURO_ACCESS_TOKEN_MAX_AGE_SEC,
  SENKURO_OAUTH_CLIENT_ID,
  SENKURO_OAUTH_REDIRECT_URI,
  SENKURO_SSO_HOSTS,
  makePkcePair,
  parseSenkuroCallback,
  randomUrlSafe,
  senkuroAuthorizeUrl,
} from './senkuro-oauth';
import { httpFetch } from './http';

export interface LoginResult {
  cookies: string;
}

/** A gateway login page (E-Hentai onion) has no redirect: success is visible
 * only as the login form disappearing plus an auth cookie appearing. Used by
 * the poll to close the window at the right moment — unlike the old "any
 * cookie exists" rule it cannot fire on pre-login guest cookies. */
export function hasAuthenticatedSession(target: string, cookies: { name: string; value: string }[], loginFormVisible: boolean): boolean {
  if (loginFormVisible) return false;
  const has = (name: string): boolean => cookies.some((c) => c.name === name && !!c.value);
  if (/nhentai.*\.onion/i.test(target)) return has('access_token') || has('refresh_token');
  if (/exhentai|e-hentai/i.test(target)) return has('onikakushi') || has('ipb_member_id');
  if (/senkuro/i.test(target)) return has('remixsid') || has('session_id') || has('access_token');
  return false;
}

export async function runLoginWindow(loginUrl: string, torSocksAddr: string): Promise<LoginResult | null> {
  // A per-login `persist:onion-login-<timestamp>` partition left a directory
  // with auth cookies in userData forever (one per login). One fixed partition,
  // wiped before and after each login, keeps no stale session on disk.
  const ses = session.fromPartition('persist:site-login');
  try {
    await ses.clearStorageData();
    await ses.clearCache();
  } catch {
    /* best-effort */
  }

  // Proxy all requests from this session through Tor. This MUST finish before
  // the first navigation: setProxy is async, and loading a .onion before the
  // proxy is applied either goes direct (immediate failure) or waits on the
  // wrong route — which looked like the login page taking forever.
  if (torSocksAddr.trim()) {
    try {
      await ses.setProxy({
        proxyRules: `socks5://${torSocksAddr.trim().replace(/^socks5h?:\/\//, '')}`,
        proxyBypassRules: '',
      });
    } catch {
      /* keep going; the window will show the network error */
    }
  }

  // Senkuro: open the real SSO authorization page instead of the site homepage
  // (whose "Войти" is a button + modal). The website's own flow is OAuth+PKCE:
  // /oauth/authorize → /auth/login → /auth/oauth/callback?code=…. We generate
  // the PKCE pair, intercept the callback and exchange the code for an
  // access_token, which is the same cookie the app's API calls already read.
  const senkuroFlow = isSenkuroHost(loginUrl);
  const senkuro = senkuroFlow
    ? { ...makePkcePair(), state: randomUrlSafe(32), ssoIndex: 0, busy: false }
    : null;
  const buildStartUrl = (): string =>
    senkuro
      ? senkuroAuthorizeUrl({
          ssoBase: SENKURO_SSO_HOSTS[senkuro.ssoIndex]!,
          state: senkuro.state,
          challenge: senkuro.challenge,
        })
      : loginUrl;
  // Navigation target — for Senkuro it is the SSO authorize URL, not the site.
  let startUrl = buildStartUrl();

  /** Both SSO hosts speak the same OAuth service; fall back to the other one
   * when the first cannot be reached (DNS/guard block on one host). */
  const switchSenkuroSsoHost = (): boolean => {
    if (!senkuro || senkuro.ssoIndex + 1 >= SENKURO_SSO_HOSTS.length) return false;
    senkuro.ssoIndex++;
    startUrl = buildStartUrl();
    logger.info('[login] Senkuro SSO host failed — switching to', SENKURO_SSO_HOSTS[senkuro.ssoIndex]);
    return true;
  };

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Логин — окно закроется автоматически после успешного входа',
      backgroundColor: '#181818',
      autoHideMenuBar: true,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    denyAllPermissions(ses);

    let done = false;
    const loadAttempt = 0;
    const finish = (result: LoginResult | null): void => {
      if (done) return;
      done = true;
      win.close();
      resolve(result);
    };

    // Floating status overlay so the user always sees what the window is
    // doing: through Tor an onion page can take 10-30 s of blank loading.
    let statusEl: string = `Загрузка через Tor…`;
    const injectStatus = async (): Promise<void> => {
      try {
        await win.webContents.executeJavaScript(`
          (function() {
            var st = document.getElementById('manga-login-status');
            if (!st) {
              st = document.createElement('div');
              st.id = 'manga-login-status';
              st.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:999999;'
                + 'padding:6px 10px;background:rgba(30,30,30,.9);color:#9fe;font:'
                + '12px monospace;text-align:center;pointer-events:none;';
              (document.body || document.documentElement).appendChild(st);
            }
            st.style.display = 'block';
            st.textContent = ${JSON.stringify(statusEl)};
            return true;
          })()
        `);
      } catch {
        /* page not ready yet — retried on load events */
      }
    };
    const hideStatus = (): void => {
      void win.webContents
        .executeJavaScript(`var st = document.getElementById('manga-login-status'); if (st) st.style.display = 'none';`)
        .catch(() => {});
    };

    // DDoS-Guard can hard-block the whole senkuro.me zone for a user's network
    // ("Владелец сайта запретил доступ из вашей сети" — the block screen users
    // report). The site also answers on senkuro.com, so the login continues
    // there; cookies come from the same session, so the saved session is
    // identical. Only the .me -> .com direction is attempted once: if the
    // mirror is blocked as well we say so instead of ping-ponging.
    let senkuroSwitchTried = false;
    let senkuroBlockNotified = false;
    const maybeSwitchSenkuroDomain = async (): Promise<void> => {
      if (done) return;
      const current = win.webContents.getURL();
      if (!isSenkuroHost(current)) return;
      let pageText = '';
      try {
        pageText = String(
          await win.webContents.executeJavaScript(
            `((document.title || '') + '\\n' + (((document.body && document.body.innerText) || '').slice(0, 8000)))`,
          ),
        );
      } catch {
        return;
      }
      const alt = senkuroFallbackUrl(current, pageText);
      if (!alt) return;
      if (senkuroSwitchTried) {
        if (senkuroBlockNotified) return;
        senkuroBlockNotified = true;
        statusEl = 'Senkuro блокирует эту сеть и на зеркале — попробуй другую сеть или VPN.';
        void injectStatus();
        return;
      }
      senkuroSwitchTried = true;
      logger.info('[login] senkuro blocked for this network — switching to', alt);
      statusEl = 'senkuro.me заблокирован DDoS-Guard — открываю senkuro.com…';
      void injectStatus();
      setTimeout(() => {
        if (done) return;
        void win.webContents.loadURL(alt).catch((e) => logger.info('[login] senkuro mirror load failed:', e?.message ?? e));
      }, 1200);
    };

    // First-document watchdog: a bad Tor circuit can leave the login page
    // blank for a minute or more. If the FIRST document has not rendered in
    // 15 s, ask Tor for a fresh circuit and reload (max two attempts). After
    // the form is visible we never auto-reload — that would wipe user input.
    let firstPageReady = false;
    let loadStartedAt = Date.now();
    let slowRetries = 0;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const clearSlowTimer = (): void => {
      if (slowTimer) {
        clearTimeout(slowTimer);
        slowTimer = undefined;
      }
    };
    const armSlowTimer = (): void => {
      clearSlowTimer();
      if (done || firstPageReady) return;
      slowTimer = setTimeout(async () => {
        if (done || firstPageReady || slowRetries >= 2) return;
        slowRetries++;
        const waited = Math.round((Date.now() - loadStartedAt) / 1000);
        logger.info(`[login] first document still loading after ${waited}s — new Tor circuit (retry ${slowRetries}/2)`);
        statusEl = `Tor-цепь медленная — переключаю и загружаю заново (${slowRetries}/2)…`;
        void injectStatus();
        await requestNewTorCircuit();
        if (!done && !firstPageReady) {
          void win.webContents.loadURL(startUrl).catch((e) => logger.info('[login] slow reload failed:', e?.message ?? e));
        }
        armSlowTimer();
      }, 15_000);
    };

    win.webContents.on('did-start-loading', () => {
      if (done || !win.webContents.isLoadingMainFrame()) return;
      loadStartedAt = Date.now();
      void injectStatus();
      armSlowTimer();
    });
    win.webContents.on('dom-ready', () => {
      if (done) return;
      if (!firstPageReady) {
        firstPageReady = true;
        clearSlowTimer();
        logger.info(`[login] first document ready in ${Date.now() - loadStartedAt}ms url=${win.webContents.getURL()}`);
      }
      hideStatus();
    });
    win.webContents.on('did-finish-load', () => {
      if (!done) logger.info(`[login] did-finish-load in ${Date.now() - loadStartedAt}ms url=${win.webContents.getURL()}`);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
      // -3 (ABORTED) is normal during OAuth redirects and user-driven nav.
      if (done || !isMain || code === -3) return;
      logger.info(`[login] did-fail-load ${code} ${desc} after ${Date.now() - loadStartedAt}ms url=${url}`);
      statusEl = senkuro
        ? `Ошибка загрузки страницы входа Senkuro (net ${code} ${desc}). Проверь сеть.`
        : `Ошибка загрузки (net ${code} ${desc}). Tor запущен и адрес SOCKS корректен?`;
      void injectStatus();
      // Senkuro: try the other SSO host before giving up.
      const switchedSso = switchSenkuroSsoHost();
      // One automatic retry soon after; keep the overlay visible meanwhile.
      setTimeout(() => {
        if (done) return;
        void win.webContents.loadURL(startUrl).catch((e) => {
          dlog('retry loadURL failed: ' + (e?.message ?? e));
        });
      }, switchedSso ? 800 : 3000);
    });

    const dbg = process.env.MR_LOGIN_DEBUG === '1';
    const dlog = (msg: string): void => {
      if (dbg) logger.info('[login-debug]', new Date().toISOString().slice(11, 23), msg);
    };

    // OAuth providers (VK, SSO) authorize through a popup — the flow relies
    // on window.open + postMessage, so it CANNOT be inlined. Allow the
    // popup: it inherits this window's session, so every cookie set there
    // is still collected by grabCookies(). Capture completes via the
    // «✅ Готово» button regardless of which window loaded last.
    win.webContents.setWindowOpenHandler((details) => {
      dlog(`window-open -> ${details.url}`);
      let ok = false;
      try {
        ok = /^https?:$/.test(new URL(details.url).protocol);
      } catch {
        ok = false;
      }
      if (!ok) return { action: 'deny' };
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 900, height: 700 } };
    });
    win.webContents.on('will-navigate', (event, url) => {
      let ok = false;
      try {
        ok = /^https?:$/.test(new URL(url).protocol);
      } catch {
        ok = false;
      }
      if (!ok) event.preventDefault();
    });
    win.webContents.on('did-create-window', (child) => {
      dlog('child window created');
      child.webContents.on('did-start-navigation', (_e, u) => dlog('child navigate -> ' + u));
      child.webContents.on('did-fail-load', (_e, code, desc, _u, isMain) => {
        if (isMain && code !== -3) dlog(`child LOAD FAIL ${code} ${desc}`);
      });
      child.webContents.on('did-finish-load', () => dlog('child did-finish-load url=' + child.webContents.getURL()));
      child.on('closed', () => dlog('child closed'));
    });

    // Intercept any request carrying the "Забрать куки" action marker.
    // (A dedicated onCompleted({urls:['manga-cookies://*']}) listener throws
    // "Invalid url pattern ... Wrong scheme type" here — the scheme is not
    // registered — which aborted the window before loadURL and produced a
    // permanently black window. So cookie collection happens right here.)
    const grabCookies = (via: string): void => {
      dlog('grabCookies called via: ' + via);
      void ses.cookies
        .get({})
        .then((list) => {
          const joined = list
            .filter((c) => c.name && c.value)
            .map((c) => `${c.name}=${c.value}`)
            .join('; ');
          if (process.env.MR_LOGIN_DEBUG === '1') {
            logger.info(
              '[login-debug] cookies grabbed:',
              list.length,
              'names:',
              list.map((c) => `${c.name}(domain=${c.domain},path=${c.path},httpOnly=${c.httpOnly})`).join(', '),
            );
          }
          finish(joined ? { cookies: joined } : null);
        })
        .catch((e) => {
          logger.warn('[login] не удалось собрать куки', e);
          finish(null);
        });
    };
    // Senkuro OAuth: the SSO redirects to /auth/oauth/callback?code=…; we never
    // let that page load. The code is exchanged for an access_token right here
    // (authorization-code + PKCE) and stored as the same `access_token` cookie
    // the website itself sets — the cookie our Senkuro API calls already send.
    const finishSenkuroOAuth = async (code: string): Promise<void> => {
      if (!senkuro || done || senkuro.busy) return;
      senkuro.busy = true;
      statusEl = 'Получаю токен Senkuro…';
      void injectStatus();
      try {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: SENKURO_OAUTH_REDIRECT_URI,
          client_id: SENKURO_OAUTH_CLIENT_ID,
          code_verifier: senkuro.verifier,
        }).toString();
        const r = await httpFetch(
          {
            url: `${SENKURO_SSO_HOSTS[senkuro.ssoIndex]!}/oauth/token`,
            method: 'POST',
            body,
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
              // The browser sends it for the site's own fetch; some OAuth
              // servers validate the client origin.
              Origin: 'https://senkuro.com',
            },
            timeoutMs: 20_000,
          },
          undefined,
        );
        let token: unknown;
        try {
          token = (JSON.parse(r.text) as { access_token?: unknown }).access_token;
        } catch {
          token = undefined;
        }
        if (r.status >= 400 || typeof token !== 'string' || !token) {
          // The SSO answers plain text for bad codes ("invalid or expired
          // code") — surface it instead of a bare status.
          const detail = r.text.trim().slice(0, 200);
          throw new Error(r.status >= 400 ? `HTTP ${r.status}${detail ? `: ${detail}` : ''}` : 'сервер не вернул access_token');
        }
        await ses.cookies.set({
          url: 'https://senkuro.com/',
          name: 'access_token',
          value: token,
          path: '/',
          secure: true,
          httpOnly: false,
          sameSite: 'lax',
          expirationDate: Math.floor(Date.now() / 1000) + SENKURO_ACCESS_TOKEN_MAX_AGE_SEC,
        });
        logger.info('[login] Senkuro access_token получен и сохранён');
        grabCookies('senkuro-oauth-token');
      } catch (e: any) {
        senkuro.busy = false;
        logger.warn('[login] Senkuro token exchange failed:', e?.message ?? e);
        statusEl = `Не удалось получить токен Senkuro: ${e?.message ?? e}. Попробуй войти ещё раз.`;
        void injectStatus();
      }
    };

    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      if (details.url.startsWith('manga-cookies://done')) {
        callback({ cancel: true });
        grabCookies('manga-cookies://done');
        return;
      }
      if (senkuro) {
        const cb = parseSenkuroCallback(details.url);
        if (cb) {
          callback({ cancel: true });
          if (cb.error) {
            statusEl = `Senkuro отклонил вход: ${cb.error}`;
            void injectStatus();
          } else if (cb.state !== senkuro.state) {
            statusEl = 'Senkuro вернул неверное состояние авторизации — закрой окно и попробуй снова.';
            void injectStatus();
          } else {
            void finishSenkuroOAuth(cb.code);
          }
          return;
        }
      }
      if (dbg) {
        // What does the login form actually submit? (cf-turnstile-response
        // present / empty is the key question for "капча не пройдена".)
        if (String(details.method).toUpperCase() === 'POST' && details.url.includes('/login')) {
          const body = (details.uploadData ?? [])
            .map((d: any) => (d.bytes ? Buffer.from(d.bytes).toString('utf8').slice(0, 2000) : (d.file ?? '')))
            .join('||');
          const redacted = body
            .replace(/(cf-turnstile-response=)[^&]{20}/g, '$1<token-present>')
            .replace(/("captcha_response":\s*")[^"]{20}/g, '$1<token-present>')
            .replace(/"password":\s*"[^"]*"/g, '"password":"<redacted>"');
          dlog(`POST body ${details.url}: ${redacted || '<empty-or-unsent>'}`);
        }
      }
      callback({});
    });

    // Chromium does not store `Secure` cookies served over plain http:// —
    // and .onion sites only exist over http, yet their backends assume HTTPS
    // (nhentai onion sets access_token/refresh_token with `Secure`, Chromium
    // drops them, /auth/refresh 401s and the page drops back to /login while
    // the captcha widget still shows its green check). Strip the `Secure`
    // flag from Set-Cookie on onion hosts so the session actually persists.
    ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
      const host = (() => {
        try {
          return new URL(details.url).hostname;
        } catch {
          return '';
        }
      })();
      const respHeaders: Record<string, string[]> = { ...details.responseHeaders };
      let modified = false;
      if (host.endsWith('.onion')) {
        for (const k of Object.keys(respHeaders)) {
          if (k.toLowerCase() === 'set-cookie') {
            respHeaders[k] = (respHeaders[k] ?? []).map((c) => {
              const stripped = c.replace(/;\s*secure\b/gi, '');
              if (dbg && stripped !== c) dlog(`stripped Secure: ${stripped.split(';')[0]}`);
              return stripped;
            });
            modified = true;
          }
        }
      }
      if (dbg && /\/auth\/|\/login/.test(details.url)) {
        const sc: string[] = [];
        for (const k of Object.keys(respHeaders)) {
          if (k.toLowerCase() === 'set-cookie') for (const v of respHeaders[k] ?? []) sc.push(v);
        }
        dlog(`RESP ${details.statusCode ?? '?'} ${details.url} set-cookie: ${sc.join(' || ')}`);
      }
      callback(modified ? { responseHeaders: respHeaders } : {});
    });

    if (dbg) {
      try {
        ses.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details: any, cb) => {
          if (String(details?.url ?? '').includes('/auth/refresh')) {
            const hdr = (details.requestHeaders ?? {}) as Record<string, string>;
            const ck = hdr['Cookie'] ?? hdr['cookie'] ?? '<none>';
            dlog(`REFRESH req ${details.method} ${details.url} cookie-header: ${ck || '<empty>'}`);
          }
          cb({});
        });
      } catch {
        /* ignore diagnostics failure */
      }
    }

    // debug-only: WHY does a 200 not produce a session? Log every Set-Cookie
    // on /auth/* responses and the response body of the login POST itself.
    if (dbg) {
      win.webContents.on('did-finish-load', () => {
        if (win.webContents.getURL().includes('/login')) {
          win.webContents
            .executeJavaScript(
              `
            (function() {
              if (window.__mr_fetch_hook__) return;
              window.__mr_fetch_hook__ = 1;
              var of = window.fetch;
              window.fetch = function(input, init) {
                var url = typeof input === 'string' ? input : (input && input.url) || '';
                var pr = of.apply(window, arguments);
                if (url.indexOf('/login') !== -1) {
                  pr.then(function(r) {
                    var c = r.clone();
                    return c.text().then(function(t) {
                      console.log('[mr-login] resp ' + r.status + ' ' + url + ' : ' + String(t).slice(0, 800));
                    });
                  }).catch(function(e) { console.log('[mr-login] hook err ' + e); });
                }
                return pr;
              };
            })();`,
            )
            .catch(() => {});
        }
      });
    }

    // Inject a floating "Готово, забрать куки" button + a fetch handler
    win.webContents.on('did-finish-load', () => {
      if (done) return;
      void maybeSwitchSenkuroDomain();
      const script = `
        (function() {
          var btn = document.createElement('button');
          btn.textContent = '✅ Готово, забрать куки';
          btn.style.cssText = 'position:fixed;top:8px;right:8px;z-index:999999;'
            + 'padding:10px 16px;background:#2ecc71;color:#fff;border:none;'
            + 'border-radius:6px;font-size:14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)';
          btn.onclick = function() {
            var all = [];
            document.cookie.split(';').forEach(function(c) {
              var eq = c.indexOf('=');
              if (eq > 0) all.push(c.trim());
            });
            fetch('manga-cookies://done?cookies=' + encodeURIComponent(all.join('; ')));
          };
          (document.body || document.documentElement).appendChild(btn);
          ${
            isSenkuroHost(win.webContents.getURL())
              ? `
          // Senkuro login is an OAuth SSO redirect chain seeded from the
          // homepage layout — auto-click the first auth/login link.
          setTimeout(function() {
            try {
              var link = Array.prototype.find.call(document.querySelectorAll('a[href]'), function(a) {
                return /oauth\\/authorize|\\u002Fauth\\u002F|login/i.test(a.getAttribute('href') || '');
              });
              if (link) link.click();
            } catch (e) {}
          }, 1500);`
              : ''
          }
        })();
      `;
      win.webContents.executeJavaScript(script).catch(() => {});
    });

    win.on('closed', () => {
      // Drop the browser session once the cookies have been collected: the app
      // keeps its own cookie jar, so nothing here needs to survive on disk.
      const wipe = (): void => {
        void ses.clearStorageData().catch(() => {});
        void ses.clearCache().catch(() => {});
      };
      if (!done) {
        // Try to grab whatever HttpOnly cookies we can on close
        void ses.cookies
          .get({})
          .then((list) => {
            const joined = list
              .filter((c) => c.name && c.value)
              .map((c) => `${c.name}=${c.value}`)
              .join('; ');
            finish(joined ? { cookies: joined } : null);
          })
          .catch(() => finish(null))
          .finally(wipe);
      } else {
        wipe();
      }
    });

    // Live login diagnostics in the status overlay: report the login POST
    // result and warn when the page's Login button is still disabled
    // (the site keeps it disabled until Turnstile/Proof-of-Work passes —
    // clicking it does nothing, which looks like "nothing happens").
    try {
      ses.webRequest.onCompleted({ urls: ['*://*/*'] }, (details: any) => {
        if (done) return;
        const u = String(details?.url ?? '');
        if (String(details?.method ?? '') === 'POST' && u.includes('/login')) {
          statusEl = `Вход отправлен → HTTP ${details.statusCode ?? '?'}`;
          void injectStatus();
          dlog(`POST ${u} -> HTTP ${details.statusCode ?? '?'} statusLine=${String(details?.statusLine ?? '')}`);
        }
      });
    } catch {
      /* pattern errors must never kill the window again */
    }

    // debug-only: surface the page's console messages (the site may log the
    // captcha rejection reason there).
    if (dbg) {
      win.webContents.on('console-message', (_e, _lvl, msg, line, src) => {
        dlog(`page-console (${src ?? '?'}:${line ?? '?'}): ${String(msg).slice(0, 400)}`);
      });
    }

    let seenLogin = false;
    const poll = setInterval(() => {
      if (done) {
        clearInterval(poll);
        return;
      }
      const ws = win.webContents;
      void (async () => {
        try {
          const url = ws.getURL();
          const onLoginOrSso = /\/login|sso\.|act=login/i.test(url);
          if (onLoginOrSso) seenLogin = true;
          if (!done && dbg) {
            void ses.cookies
              .get({})
              .then((list) => {
                dlog(
                  'poll url=' +
                    url +
                    ' seenLogin=' +
                    seenLogin +
                    ' cookies: ' +
                    list
                      .filter((c) => c.name && !/^(prepole|__qca|__utm)/.test(c.name))
                      .map((c) => c.name)
                      .join(','),
                );
              })
              .catch(() => {});
          }
          // Auto-finish ONLY when the flow is truly done: back on the target
          // site's own domain, no login/SSO markers in the URL. Both Senkuro
          // domains count: the login may have been completed on the .com
          // mirror after DDoS-Guard blocked .me for this network.
          const onTargetSite = url.startsWith('http') && !onLoginOrSso && /senkuro\.(me|com)|nhentai\.net|\.onion/.test(url);
          if (seenLogin && onTargetSite) {
            clearInterval(poll);
            statusEl = 'Вход признан успешным — собираю куки…';
            void injectStatus();
            setTimeout(() => {
              if (!done) grabCookies('redirect-back-to-site');
            }, 2000);
            return;
          }
          // E-Hentai/exhentai and nhentai-onion gateway logins happen on the
          // target URL itself and have no /login redirect. Closing on "any
          // cookie exists" grabbed pre-login guest cookies (nhentai
          // `tor_session`), so require both: the login form is gone AND an
          // auth-level cookie is present.
          const jar = await ses.cookies.get({});
          const loginFormVisible = await ws
            .executeJavaScript(
              `!!document.querySelector('input[type="password"],input[name="UserName"],input[name="PassWord"],input[name="username_or_email"]')`,
            )
            .catch(() => true);
          if (!done && onTargetSite && hasAuthenticatedSession(loginUrl, jar, loginFormVisible)) {
            clearInterval(poll);
            statusEl = 'Вход выполнен — собираю куки…';
            void injectStatus();
            setTimeout(() => {
              if (!done) grabCookies('authenticated-session');
            }, 1500);
            return;
          }
          if (seenLogin) {
            const disabled = await ws
              .executeJavaScript("var b=document.querySelector('button[type=submit]'); b ? b.disabled : null")
              .catch(() => null);
            if (disabled === true) {
              statusEl =
                'Кнопка Login заблокирована — страница ждёт капчу Turnstile/Proof-of-Work. Дождись, пока проверка пройдёт; если спиннер крутится дольше минуты — закрой окно и войди снова (Tor возьмёт новую цепь).';
              void injectStatus();
            }
          }
        } catch {
          /* page navigating */
        }
      })();
    }, 6000);

    // ── debug capture (env-gated): proves what the user actually sees ──
    if (process.env.MR_LOGIN_DEBUG === '1') {
      setTimeout(() => {
        void win.webContents
          .capturePage()
          .then((img) => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { writeFileSync } = require('fs') as typeof import('fs');
            const out = join(app.getPath('userData'), 'login-debug.png');
            writeFileSync(out, img.toPNG());
            const sz = img.getSize();
            logger.info('[login-debug] saved', out, img.toPNG().length, 'bytes;', JSON.stringify(sz), '; url:', win.webContents.getURL());
          })
          .catch((e) => logger.info('[login-debug] capture error', e?.message));
      }, 20000);
    }

    void win.loadURL(startUrl).catch((e) => {
      dlog('loadURL failed: ' + (e?.message ?? e));
    });
  });
}
