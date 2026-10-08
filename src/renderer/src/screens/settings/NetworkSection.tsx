import { useState } from 'react';
import Section from './Section';
import Toggle from '../../components/Toggle';
import type { BridgeStatus, SiteStatus, TorStatus } from '@shared/ipc';
import type { SettingsCommon } from './useSettings';

const TOR_SITES: { key: string; label: string }[] = [
  { key: 'ehentai', label: 'E-Hentai' },
  { key: 'nhentai', label: 'NHentai' },
  { key: 'comx', label: 'Com-X' },
  { key: 'senkuro', label: 'Senkuro' },
  { key: 'mangashi', label: 'Manga-shi' },
  { key: 'remanga', label: 'Remanga' },
  { key: 'mangalib', label: 'Mangalib' },
];

export default function NetworkSection({ settings, upd }: SettingsCommon): JSX.Element {
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const [torStatus, setTorStatus] = useState<TorStatus | null>(null);
  const [torChecking, setTorChecking] = useState(false);
  const [bridgeResults, setBridgeResults] = useState<BridgeStatus[] | null>(null);
  const [siteResults, setSiteResults] = useState<SiteStatus[] | null>(null);

  const toggleTorSite = (key: string, on: boolean): void => {
    const set = new Set(settings.tor_proxied_sites);
    if (on) set.add(key);
    else set.delete(key);
    upd({ tor_proxied_sites: [...set] });
  };

  const doLogin = async (url: string, label: string): Promise<void> => {
    setLoginMsg(`${label}: открываю окно логина…`);
    try {
      const cookies = await window.api.loginSite(url);
      setLoginMsg(cookies ? `${label}: куки сохранены` : `${label}: отменено`);
    } catch (e: any) {
      setLoginMsg(`${label}: ошибка — ${e?.message ?? e}`);
    }
  };

  return (
    <Section title="Network & Accounts">
      <div className="row">
        <Toggle checked={settings.enable_domain_fronting} onChange={(v) => upd({ enable_domain_fronting: v })}>
          Domain Fronting для ExHentai (доступ без VPN, когда DNS заблокирован)
        </Toggle>
      </div>
      <div className="row">
        <label>Встроенный Tor (little-t):</label>
        <Toggle checked={settings.builtin_tor} onChange={(v) => upd({ builtin_tor: v })} />
        <span className="muted">свой демон внутри приложения — адрес Tor Browser не требуется; SOCKS: 127.0.0.1:9153</span>
      </div>
      <div className="row">
        <label>Tor SOCKS-адрес:</label>
        <input className="text-input" value={settings.tor_socks_addr} onChange={(e) => upd({ tor_socks_addr: e.target.value })} />
        <button title="Сбросить на 127.0.0.1:9150" onClick={() => upd({ tor_socks_addr: '127.0.0.1:9150' })}>
          ↺
        </button>
        <button
          disabled={torChecking}
          onClick={async () => {
            setTorChecking(true);
            setTorStatus(null);
            try {
              setTorStatus(await window.api.checkTor());
            } finally {
              setTorChecking(false);
            }
          }}
        >
          Проверить Tor
        </button>
      </div>
      {torStatus && (
        <div className={`check-result ${torStatus.state === 'connected' ? 'ok' : 'bad'}`}>
          {torStatus.state === 'connected' ? `✓ Tor работает (${torStatus.latencyMs} мс)` : `✗ Tor недоступен: ${torStatus.reason}`}
        </div>
      )}
      <div className="row">
        <label>Трафик сайтов через Tor:</label>
      </div>
      <div className="tor-toggles">
        {TOR_SITES.map((s) => (
          <Toggle
            key={s.key}
            className="tor-toggle"
            checked={settings.tor_proxied_sites.includes(s.key)}
            onChange={(v) => toggleTorSite(s.key, v)}
          >
            {s.label}
          </Toggle>
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
        <button
          onClick={async () => {
            const lines = settings.tor_bridges
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean);
            setBridgeResults(lines.length ? await window.api.checkBridges(lines) : []);
          }}
        >
          Проверить мосты
        </button>
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
        <label>NHentai куки (clearnet):</label>
        <textarea
          className="cookie-input"
          rows={4}
          value={settings.nhentai_cookies_raw}
          placeholder={'name=value по одной на строку'}
          onChange={(e) => upd({ nhentai_cookies_raw: e.target.value })}
        />
      </div>
      <div className="row">
        <button onClick={() => void doLogin('https://nhentai.net', 'NHentai')}>Войти в NHentai</button>
      </div>
      <div className="row">
        <label>NHentai onion base:</label>
        <input
          className="text-input"
          value={settings.nhentai_onion_base}
          placeholder="http://...onion"
          onChange={(e) => upd({ nhentai_onion_base: e.target.value })}
        />
        <button title="Очистить (вернуть встроенный дефолт)" onClick={() => upd({ nhentai_onion_base: '' })}>
          ↺
        </button>
      </div>
      <div className="row">
        {/* Senkuro's login is an OAuth SSO flow (sso.senkuro.net) whose
          authorize URL is minted per session — so open the homepage and
          let the user click «Войти» there. */}
        <button onClick={() => void doLogin('https://senkuro.me/', 'Senkuro')}>Войти в Senkuro</button>
      </div>
      <div className="row">
        <label>Senkuro куки:</label>
        <textarea
          className="cookie-input"
          rows={4}
          value={settings.senkuro_cookies_raw}
          placeholder={'name=value по одной на строку'}
          onChange={(e) => upd({ senkuro_cookies_raw: e.target.value })}
        />
      </div>
      <div className="row">
        <label>Mangalib прокси (SOCKS|host:port, напр. 127.0.0.1:7890):</label>
        <input
          className="text-input"
          value={settings.mangalib_proxy_addr}
          placeholder="пусто = напрямую (нужен VPN/Беларусь)"
          onChange={(e) => upd({ mangalib_proxy_addr: e.target.value })}
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
  );
}
