import { BrowserWindow, session, app } from 'electron'
import { join } from 'path'
import { buildSocksDispatcher } from './http'

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
      })
    }

    const win = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Onion логин — закрой окно после входа, куки заберутся автоматически',
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      webPreferences: {
        session: ses,
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    let done = false
    const finish = (result: LoginResult | null): void => {
      if (done) return
      done = true
      win.close()
      resolve(result)
    }

    win.webContents.on('will-navigate', () => { /* keep browsing */ })

    // Intercept any request carrying the "Забрать куки" action marker
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      if (details.url.startsWith('manga-cookies://done')) {
        callback({ cancel: true })
        return
      }
      callback({})
    })

    // Inject a floating "Готово, забрать куки" button + a fetch handler
    win.webContents.on('did-finish-load', () => {
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
          document.body.appendChild(btn);
        })();
      `
      win.webContents.executeJavaScript(script).catch(() => {})
    })

    ses.webRequest.onCompleted({ urls: ['manga-cookies://*'] }, () => {
      const cookies = ses.cookies.get({}).then((list) => {
        const joined = list
          .filter((c) => c.name && c.value)
          .map((c) => `${c.name}=${c.value}`)
          .join('; ')
        finish({ cookies: joined })
      }).catch(() => finish(null))
      void cookies
    })

    win.on('closed', () => {
      if (!done) {
        // Try to grab whatever HttpOnly cookies we can on close
        ses.cookies.get({}).then((list) => {
          const joined = list
            .filter((c) => c.name && c.value)
            .map((c) => `${c.name}=${c.value}`)
            .join('; ')
          finish(joined ? { cookies: joined } : null)
        }).catch(() => finish(null))
      }
    })

    win.loadURL(loginUrl).catch(() => finish(null))
  })
}