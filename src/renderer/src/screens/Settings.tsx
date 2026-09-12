import { useState } from 'react'
import { useStore } from '../state/store'
import type { TorStatus, BridgeStatus, SiteStatus } from '@shared/ipc'

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="settings-section">
      <h3 className="settings-heading">{title}</h3>
      {children}
    </div>
  )
}

const TOR_SITES: { key: string; label: string }[] = [
  { key: 'ehentai', label: 'E-Hentai' },
  { key: 'nhentai', label: 'NHentai' },
  { key: 'comx', label: 'Com-X' },
  { key: 'senkuro', label: 'Senkuro' },
  { key: 'mangashi', label: 'Manga-shi' },
  { key: 'remanga', label: 'Remanga' },
  { key: 'mangalib', label: 'Mangalib' }
]

export default function Settings(): JSX.Element {
  const { settings, setSettings } = useStore()
  const [loginMsg, setLoginMsg] = useState<string | null>(null)
  const [torStatus, setTorStatus] = useState<TorStatus | null>(null)
  const [torChecking, setTorChecking] = useState(false)
  const [bridgeResults, setBridgeResults] = useState<BridgeStatus[] | null>(null)
  const [siteResults, setSiteResults] = useState<SiteStatus[] | null>(null)

  const upd = (patch: Partial<typeof settings>): void => setSettings({ ...settings, ...patch })

  const toggleTorSite = (key: string, on: boolean): void => {
    const set = new Set(settings.tor_proxied_sites)
    if (on) set.add(key)
    else set.delete(key)
    upd({ tor_proxied_sites: [...set] })
  }

  const doLogin = async (url: string, label: string): Promise<void> => {
    setLoginMsg(`${label}: открываю окно логина…`)
    try {
      const cookies = await window.api.loginSite(url)
      setLoginMsg(cookies ? `${label}: куки сохранены` : `${label}: отменено`)
    } catch (e: any) {
      setLoginMsg(`${label}: ошибка — ${e?.message ?? e}`)
    }
  }

  return (
    <div className="screen">
      <div className="settings-scroll">
        <Section title="Reading">
          <div className="row">
            <label>Mode:</label>
            <select
              value={settings.reading_mode}
              onChange={(e) => upd({ reading_mode: e.target.value as 'Scroll' | 'Book' })}
            >
              <option value="Scroll">Scroll</option>
              <option value="Book">Book</option>
            </select>
          </div>
          {settings.reading_mode === 'Book' && (
            <>
              <div className="row">
                <label>Direction:</label>
                <select
                  value={settings.book_direction}
                  onChange={(e) => upd({ book_direction: e.target.value as 'Ltr' | 'Rtl' })}
                >
                  <option value="Rtl">RTL (manga)</option>
                  <option value="Ltr">LTR</option>
                </select>
              </div>
              <div className="row">
                <label>Pages per screen: {settings.pages_per_screen}</label>
                <input
                  type="range" min={1} max={2} step={1}
                  value={settings.pages_per_screen}
                  onChange={(e) => upd({ pages_per_screen: Number(e.target.value) })}
                />
              </div>
              <div className="row">
                <label>Page margin: {settings.page_margin}</label>
                <input
                  type="range" min={0} max={30} step={1}
                  value={settings.page_margin}
                  onChange={(e) => upd({ page_margin: Number(e.target.value) })}
                />
              </div>
            </>
          )}
          {settings.reading_mode === 'Scroll' && (
            <div className="row">
              <label>Width scale: {settings.width_scale.toFixed(2)}</label>
              <input
                type="range" min={0.3} max={1} step={0.01}
                value={settings.width_scale}
                onChange={(e) => upd({ width_scale: Number(e.target.value) })}
              />
            </div>
          )}
        </Section>

        <Section title="Display">
          <div className="row">
            <label>
              <input
                type="checkbox"
                checked={settings.show_thumbnails}
                onChange={(e) => upd({ show_thumbnails: e.target.checked })}
              /> Show thumbnails
            </label>
          </div>
          <div className="row">
            <label>Thumbnail size: {settings.thumb_size}</label>
            <input
              type="range" min={60} max={200} step={5}
              value={settings.thumb_size}
              onChange={(e) => upd({ thumb_size: Number(e.target.value) })}
            />
          </div>
        </Section>

        <Section title="Network & Accounts">
          <div className="row">
            <label>Tor SOCKS-адрес:</label>
            <input
              className="text-input"
              value={settings.tor_socks_addr}
              onChange={(e) => upd({ tor_socks_addr: e.target.value })}
            />
            <button
              disabled={torChecking}
              onClick={async () => {
                setTorChecking(true)
                setTorStatus(null)
                try { setTorStatus(await window.api.checkTor()) } finally { setTorChecking(false) }
              }}
            >Проверить Tor</button>
          </div>
          {torStatus && (
            <div className={`check-result ${torStatus.state === 'connected' ? 'ok' : 'bad'}`}>
              {torStatus.state === 'connected'
                ? `✓ Tor работает (${torStatus.latencyMs} мс)`
                : `✗ Tor недоступен: ${torStatus.reason}`}
            </div>
          )}
          <div className="row">
            <label>Трафик сайтов через Tor:</label>
          </div>
          <div className="tor-toggles">
            {TOR_SITES.map((s) => (
              <label key={s.key} className="tor-toggle">
                <input
                  type="checkbox"
                  checked={settings.tor_proxied_sites.includes(s.key)}
                  onChange={(e) => toggleTorSite(s.key, e.target.checked)}
                /> {s.label}
              </label>
            ))}
          </div>
          <div className="row">
            <label>Мосты Tor (по одному на строку):</label>
          </div>
          <textarea
            className="cookie-input"
            rows={3}
            value={settings.tor_bridges}
            placeholder={'obfs4 192.0.2.1:443 FINGERPRINT cert=... iat-mode=0'}
            onChange={(e) => upd({ tor_bridges: e.target.value })}
          />
          <div className="row">
            <button onClick={async () => {
              const lines = settings.tor_bridges.split('\n').map((l) => l.trim()).filter(Boolean)
              setBridgeResults(lines.length ? await window.api.checkBridges(lines) : [])
            }}>Проверить мосты</button>
            <button onClick={async () => setSiteResults(await window.api.checkSites())}>Доступность сайтов</button>
          </div>
          {bridgeResults && (
            <div className="check-list">
              {bridgeResults.map((b) => (
                <div key={b.line} className={`check-result ${b.state === 'reachable' ? 'ok' : 'bad'}`}>
                  {b.state === 'reachable' ? '✓' : b.state === 'unparsable' ? '⚠' : '✗'} {b.line}
                  {b.state === 'reachable' && b.latencyMs != null ? ` (${b.latencyMs} мс)` : b.reason ? ` — ${b.reason}` : ''}
                </div>
              ))}
            </div>
          )}
          {siteResults && (
            <div className="check-list">
              {siteResults.map((s) => (
                <div key={s.key} className={`check-result ${s.state === 'up' ? 'ok' : 'bad'}`}>
                  {s.state === 'up' ? '✓' : '✗'} {s.key}
                  {s.state === 'down' && s.reason ? ` — ${s.reason}` : ''}
                </div>
              ))}
            </div>
          )}
          <div className="row">
            <label>ExHentai (onion) куки:</label>
            <textarea
              className="cookie-input"
              rows={4}
              value={settings.onion_cookies_raw}
              placeholder={'name=value по одной на строку'}
              onChange={(e) => upd({ onion_cookies_raw: e.target.value })}
            />
          </div>
          <div className="row">
            <button onClick={() => void doLogin('http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion', 'ExHentai onion')}>
              Войти в ExHentai (onion)
            </button>
          </div>
          <div className="row">
            <label>NHentai (onion) куки:</label>
            <textarea
              className="cookie-input"
              rows={4}
              value={settings.nhentai_onion_cookies_raw}
              placeholder={'name=value по одной на строку'}
              onChange={(e) => upd({ nhentai_onion_cookies_raw: e.target.value })}
            />
          </div>
          <div className="row">
            <button onClick={() => void doLogin('http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion', 'NHentai onion')}>
              Войти в NHentai (onion)
            </button>
          </div>
          <div className="row">
            <label>NHentai onion base:</label>
            <input
              className="text-input"
              value={settings.nhentai_onion_base}
              placeholder="http://...onion"
              onChange={(e) => upd({ nhentai_onion_base: e.target.value })}
            />
          </div>
          <div className="row">
            <label>ExHentai прокси (обычный):</label>
            <input
              className="text-input"
              value={settings.exhentai_proxy_addr}
              onChange={(e) => upd({ exhentai_proxy_addr: e.target.value })}
            />
          </div>
          {loginMsg && <div className="login-msg muted">{loginMsg}</div>}
        </Section>

        <Section title="🔒 Приватность">
          <div className="row">
            <label>
              <input
                type="checkbox"
                checked={settings.show_r34_history}
                onChange={(e) => upd({ show_r34_history: e.target.checked })}
              /> Показывать вкладку R34 в истории
            </label>
          </div>
        </Section>
      </div>
    </div>
  )
}