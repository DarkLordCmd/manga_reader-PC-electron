import { BrowserWindow, session, app } from 'electron'
import { join } from 'path'
import { buildSocksDispatcher } from './http'
import { denyAllPermissions } from '../security'

export interface LoginResult {
  cookies: string
}

export function runLoginWindow(loginUrl: string, torSocksAddr: string): Promise<LoginResult | null> {
  return new Promise((resolve) => {
    const ses = session.fromPartition(`persist:onion-login-${Date.now()}`)

    // Proxy all requests from this session through Tor
    if (torSocksAddr.trim()) {
      ses.setProxy({
        proxyRules: `socks5://${torSocksAddr.trim().replace(/^socks5h?:\/\//, '')}`,
        proxyBypassRules: ''
      }).catch(() => {})
    }

    const win = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Логин — закрой окно после входа, куки заберутся автоматически',
      backgroundColor: '#181818',
      autoHideMenuBar: true,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })

    denyAllPermissions(ses)

    let done = false
    let loadAttempt = 0
    const finish = (result: LoginResult | null): void => {
      if (done) return
      done = true
      win.close()
      resolve(result)
    }

    // Floating status overlay so the user always sees what the window is
    // doing: through Tor an onion page can take 10-30 s of blank loading.
    let statusEl: string = `Загрузка через Tor…`
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
        `)
      } catch { /* page not ready yet — retried on load events */ }
    }
    const hideStatus = (): void => {
      void win.webContents
        .executeJavaScript(`var st = document.getElementById('manga-login-status'); if (st) st.style.display = 'none';`)
        .catch(() => {})
    }

    win.webContents.on('did-start-loading', () => {
      if (done || !win.webContents.isLoadingMainFrame()) return
      void injectStatus()
    })
    win.webContents.on('dom-ready', () => { if (!done) hideStatus() })
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
      // -3 (ABORTED) is normal during OAuth redirects and user-driven nav.
      if (done || !isMain || code === -3) return
      statusEl = `Ошибка загрузки (net ${code} ${desc}). Tor запущен и адрес SOCKS корректен?`
      void injectStatus()
      // One automatic retry soon after; keep the overlay visible meanwhile.
      setTimeout(() => {
        if (done) return
        void win.webContents.loadURL(loginUrl).catch((e) => { dlog('retry loadURL failed: ' + (e?.message ?? e)) })
      }, 3000)
    })

    const dbg = process.env.MR_LOGIN_DEBUG === '1'
    const dlog = (msg: string): void => { if (dbg) console.log('[login-debug]', new Date().toISOString().slice(11, 23), msg) }

    // OAuth providers (VK, SSO) authorize through a popup — the flow relies
    // on window.open + postMessage, so it CANNOT be inlined. Allow the
    // popup: it inherits this window's session, so every cookie set there
    // is still collected by grabCookies(). Capture completes via the
    // «✅ Готово» button regardless of which window loaded last.
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
    win.webContents.on('did-create-window', (child) => {
      dlog('child window created')
      child.webContents.on('did-start-navigation', (_e, u) => dlog('child navigate -> ' + u))
      child.webContents.on('did-fail-load', (_e, code, desc, _u, isMain) => { if (isMain && code !== -3) dlog(`child LOAD FAIL ${code} ${desc}`) })
      child.webContents.on('did-finish-load', () => dlog('child did-finish-load url=' + child.webContents.getURL()))
      child.on('closed', () => dlog('child closed'))
    })

    // Intercept any request carrying the "Забрать куки" action marker.
    // (A dedicated onCompleted({urls:['manga-cookies://*']}) listener throws
    // "Invalid url pattern ... Wrong scheme type" here — the scheme is not
    // registered — which aborted the window before loadURL and produced a
    // permanently black window. So cookie collection happens right here.)
    const grabCookies = (via: string): void => {
      dlog('grabCookies called via: ' + via)
      void ses.cookies.get({}).then((list) => {
        const joined = list
          .filter((c) => c.name && c.value)
          .map((c) => `${c.name}=${c.value}`)
          .join('; ')
        if (process.env.MR_LOGIN_DEBUG === '1') {
          console.log('[login-debug] cookies grabbed:', list.length, 'names:', list.map((c) => `${c.name}(domain=${c.domain},path=${c.path},httpOnly=${c.httpOnly})`).join(', '))
        }
        finish(joined ? { cookies: joined } : null)
      }).catch(() => finish(null))
    }
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      if (details.url.startsWith('manga-cookies://done')) {
        callback({ cancel: true })
        grabCookies('manga-cookies://done')
        return
      }
      if (dbg) {
        // What does the login form actually submit? (cf-turnstile-response
        // present / empty is the key question for "капча не пройдена".)
        if (String(details.method).toUpperCase() === 'POST' && details.url.includes('/login')) {
          const body = (details.uploadData ?? [])
            .map((d: any) => (d.bytes ? Buffer.from(d.bytes).toString('utf8').slice(0, 2000) : (d.file ?? '')))
            .join('||')
          const redacted = body
            .replace(/(cf-turnstile-response=)[^&]{20}/g, '$1<token-present>')
            .replace(/("captcha_response":\s*")[^"]{20}/g, '$1<token-present>')
            .replace(/"password":\s*"[^"]*"/g, '"password":"<redacted>"')
          dlog(`POST body ${details.url}: ${redacted || '<empty-or-unsent>'}`)
        }
      }
      callback({})
    })

    // Chromium does not store `Secure` cookies served over plain http:// —
    // and .onion sites only exist over http, yet their backends assume HTTPS
    // (nhentai onion sets access_token/refresh_token with `Secure`, Chromium
    // drops them, /auth/refresh 401s and the page drops back to /login while
    // the captcha widget still shows its green check). Strip the `Secure`
    // flag from Set-Cookie on onion hosts so the session actually persists.
    ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
      const host = (() => { try { return new URL(details.url).hostname } catch { return '' } })()
      const respHeaders: Record<string, string[]> = { ...details.responseHeaders }
      let modified = false
      if (host.endsWith('.onion')) {
        for (const k of Object.keys(respHeaders)) {
          if (k.toLowerCase() === 'set-cookie') {
            respHeaders[k] = (respHeaders[k] ?? []).map((c) => {
              const stripped = c.replace(/;\s*secure\b/gi, '')
              if (dbg && stripped !== c) dlog(`stripped Secure: ${stripped.split(';')[0]}`)
              return stripped
            })
            modified = true
          }
        }
      }
      if (dbg && /\/auth\/|\/login/.test(details.url)) {
        const sc: string[] = []
        for (const k of Object.keys(respHeaders)) {
          if (k.toLowerCase() === 'set-cookie') for (const v of respHeaders[k] ?? []) sc.push(v)
        }
        dlog(`RESP ${details.statusCode ?? '?'} ${details.url} set-cookie: ${sc.join(' || ')}`)
      }
      callback(modified ? { responseHeaders: respHeaders } : {})
    })

    if (dbg) {
      try {
        ses.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details: any, cb) => {
          if (String(details?.url ?? '').includes('/auth/refresh')) {
            const hdr = (details.requestHeaders ?? {}) as Record<string, string>
            const ck = hdr['Cookie'] ?? hdr['cookie'] ?? '<none>'
            dlog(`REFRESH req ${details.method} ${details.url} cookie-header: ${ck || '<empty>'}`)
          }
          cb({})
        })
      } catch { /* ignore diagnostics failure */ }
    }

    // debug-only: WHY does a 200 not produce a session? Log every Set-Cookie
    // on /auth/* responses and the response body of the login POST itself.
    if (dbg) {
      win.webContents.on('did-finish-load', () => {
        if (win.webContents.getURL().includes('/login')) {
          win.webContents.executeJavaScript(`
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
            })();`
          ).catch(() => {})
        }
      })
    }

    // Inject a floating "Готово, забрать куки" button + a fetch handler
    win.webContents.on('did-finish-load', () => {
      if (done) return
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
          ${loginUrl.includes('senkuro.me') ? `
          // Senkuro login is an OAuth SSO redirect chain seeded from the
          // homepage layout — auto-click the first auth/login link.
          setTimeout(function() {
            try {
              var link = Array.prototype.find.call(document.querySelectorAll('a[href]'), function(a) {
                return /oauth\\/authorize|\\u002Fauth\\u002F|login/i.test(a.getAttribute('href') || '');
              });
              if (link) link.click();
            } catch (e) {}
          }, 1500);` : ''}
        })();
      `
      win.webContents.executeJavaScript(script).catch(() => {})
    })

    win.on('closed', () => {
      if (!done) {
        // Try to grab whatever HttpOnly cookies we can on close
        void ses.cookies.get({}).then((list) => {
          const joined = list
            .filter((c) => c.name && c.value)
            .map((c) => `${c.name}=${c.value}`)
            .join('; ')
          finish(joined ? { cookies: joined } : null)
        }).catch(() => finish(null))
      }
    })

    // Live login diagnostics in the status overlay: report the login POST
    // result and warn when the page's Login button is still disabled
    // (the site keeps it disabled until Turnstile/Proof-of-Work passes —
    // clicking it does nothing, which looks like "nothing happens").
    try {
      ses.webRequest.onCompleted({ urls: ['*://*/*'] }, (details: any) => {
        if (done) return
        const u = String(details?.url ?? '')
        if (String(details?.method ?? '') === 'POST' && u.includes('/login')) {
          statusEl = `Вход отправлен → HTTP ${details.statusCode ?? '?'}`
          void injectStatus()
          dlog(`POST ${u} -> HTTP ${details.statusCode ?? '?'} statusLine=${String(details?.statusLine ?? '')}`)
        }
      })
    } catch { /* pattern errors must never kill the window again */ }

    // debug-only: surface the page's console messages (the site may log the
    // captcha rejection reason there).
    if (dbg) {
      win.webContents.on('console-message', (_e, _lvl, msg, line, src) => {
        dlog(`page-console (${src ?? '?'}:${line ?? '?'}): ${String(msg).slice(0, 400)}`)
      })
    }

    let seenLogin = false
    const poll = setInterval(() => {
      if (done) { clearInterval(poll); return }
      const ws = win.webContents
      void (async () => {
        try {
          const url = ws.getURL()
          const onLoginOrSso = /\/login|sso\.|act=login/i.test(url)
          if (onLoginOrSso) seenLogin = true
          if (!done && dbg) {
            void ses.cookies.get({}).then((list) => {
              dlog('poll url=' + url + ' seenLogin=' + seenLogin + ' cookies: ' + list.filter((c) => c.name && !/^(prepole|__qca|__utm)/.test(c.name)).map((c) => c.name).join(','))
            }).catch(() => {})
          }
          // Auto-finish ONLY when the flow is truly done: back on the target
          // site's own domain, no login/SSO markers in the URL.
          const onTargetSite = url.startsWith('http') && !onLoginOrSso &&
            /senkuro\.me|nhentai\.net|.onion/.test(url)
          if (seenLogin && onTargetSite) {
            clearInterval(poll)
            statusEl = 'Вход признан успешным — собираю куки…'
            void injectStatus()
            setTimeout(() => { if (!done) grabCookies('redirect-back-to-site') }, 2000)
            return
          }
          // E-Hentai/exhentai gateway logins happen on the target URL itself
          // (the login page IS the catalog URL) and keep the session in a
          // gateway-only cookie (e.g. onikakushi) — no /login URL transition,
          // no forum auth cookies. If we are already at the target site and
          // the jar now holds a session, the flow is done: grab it.
          const jar = await ses.cookies.get({})
          if (!done && onTargetSite && jar.some((c) => c.name && c.value)) {
            clearInterval(poll)
            statusEl = 'Вход признан успешным — собираю куки…'
            void injectStatus()
            setTimeout(() => { if (!done) grabCookies('target-site-session-cookies') }, 2000)
          }
          if (seenLogin) {
            const disabled = await ws.executeJavaScript(
              "var b=document.querySelector('button[type=submit]'); b ? b.disabled : null"
            ).catch(() => null)
            if (disabled === true) {
              statusEl = 'Кнопка Login заблокирована — страница ждёт капчу Turnstile/Proof-of-Work. Дождись, пока проверка пройдёт; если спиннер крутится дольше минуты — закрой окно и войди снова (Tor возьмёт новую цепь).'
              void injectStatus()
            }
          }
        } catch { /* page navigating */ }
      })()
    }, 6000)

    // ── debug capture (env-gated): proves what the user actually sees ──
    if (process.env.MR_LOGIN_DEBUG === '1') {
      setTimeout(() => {
        void win.webContents.capturePage().then((img) => {
          const { writeFileSync } = require('fs') as typeof import('fs')
          const out = join(app.getPath('userData'), 'login-debug.png')
          writeFileSync(out, img.toPNG())
          const sz = img.getSize()
          console.log('[login-debug] saved', out, img.toPNG().length, 'bytes;', JSON.stringify(sz), '; url:', win.webContents.getURL())
        }).catch((e) => console.log('[login-debug] capture error', e?.message))
      }, 20000)
    }

    void win.loadURL(loginUrl).catch((e) => { dlog('loadURL failed: ' + (e?.message ?? e)) })
  })
}
