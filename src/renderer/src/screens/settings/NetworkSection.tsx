import { useState } from 'react';
import Section, { Row, SubHead } from './Section';
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
    <>
      <Section title="Tor и сеть" desc="Встроенный Tor, мосты и адрес SOCKS-прокси.">
        <Row label="Domain Fronting" note="Доступ к ExHentai без VPN, когда DNS заблокирован.">
          <Toggle checked={settings.enable_domain_fronting} onChange={(v) => upd({ enable_domain_fronting: v })} />
        </Row>
        <Row
          label="Встроенный Tor"
          note="Свой демон внутри приложения: адрес Tor Browser не нужен, SOCKS на 127.0.0.1:9153."
        >
          <Toggle checked={settings.builtin_tor} onChange={(v) => upd({ builtin_tor: v })} />
        </Row>
        <Row label="SOCKS-адрес">
          <input className="text-input" value={settings.tor_socks_addr} onChange={(e) => upd({ tor_socks_addr: e.target.value })} />
          <button title="Сбросить на 127.0.0.1:9150" onClick={() => upd({ tor_socks_addr: '127.0.0.1:9150' })}>
            Сброс
          </button>
          <button
            className="set-primary"
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
            {torChecking ? 'Проверяю…' : 'Проверить Tor'}
          </button>
        </Row>
        {torStatus && (
          <Row stack>
            <div className={`check-result ${torStatus.state === 'connected' ? 'ok' : 'bad'}`}>
              {torStatus.state === 'connected'
                ? `✓ Tor работает (${torStatus.latencyMs} мс)`
                : `✗ Tor недоступен: ${torStatus.reason}`}
            </div>
          </Row>
        )}
        <Row label="Сайты через Tor" stack>
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
        </Row>
        <Row label="Мосты Tor" stack note="По одному на строку. Проверка моста — это TCP-доступность порта: obfs4 может принимать соединение и всё равно не пропускать трафик. Пометка «поднимался в прошлый раз» показывает, что реально произошло при последнем запуске Tor.">
          <textarea
            className="cookie-input"
            rows={3}
            value={settings.tor_bridges}
            placeholder={'obfs4 192.0.2.1:443 FINGERPRINT cert=... iat-mode=0'}
            onChange={(e) => upd({ tor_bridges: e.target.value })}
          />
        </Row>
        <Row label="Проверка">
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
        </Row>
        {bridgeResults && (
          <Row stack>
            <div className="check-list">
              {bridgeResults.map((b) => (
                <div key={b.line} className={`check-result ${b.state === 'reachable' ? 'ok' : 'bad'}`}>
                  {b.state === 'reachable' ? '✓' : b.state === 'unparsable' ? '⚠' : '✗'} {b.line}
                  {b.state === 'reachable' && b.latencyMs != null ? ` (TCP ${b.latencyMs} мс)` : b.reason ? ` — ${b.reason}` : ''}
                  {b.lastBootstrap
                    ? b.lastBootstrap.ok
                      ? ' · поднимался в прошлый раз'
                      : ' · не поднялся в прошлый раз'
                    : ''}
                </div>
              ))}
            </div>
          </Row>
        )}
        {siteResults && (
          <Row stack>
            <div className="check-list">
              {siteResults.map((s) => (
                <div key={s.key} className={`check-result ${s.state === 'up' ? 'ok' : 'bad'}`}>
                  {s.state === 'up' ? '✓' : '✗'} {s.key}
                  {s.state === 'down' && s.reason ? ` — ${s.reason}` : ''}
                </div>
              ))}
            </div>
          </Row>
        )}
      </Section>

      <Section title="Прокси" desc="Отдельные прокси для источников, которым Tor не помогает.">
        <Row label="Mangalib" stack note="SOCKS5 host:port, например 127.0.0.1:7890. Пусто — напрямую (нужен VPN).">
          <input
            className="text-input wide"
            value={settings.mangalib_proxy_addr}
            placeholder="127.0.0.1:7890"
            onChange={(e) => upd({ mangalib_proxy_addr: e.target.value })}
          />
        </Row>
        <Row label="ExHentai" stack note="Обычный HTTP-прокси для запросов к ExHentai вне Tor.">
          <input
            className="text-input wide"
            value={settings.exhentai_proxy_addr}
            placeholder="http://127.0.0.1:8080"
            onChange={(e) => upd({ exhentai_proxy_addr: e.target.value })}
          />
        </Row>
      </Section>

      <Section title="Аккаунты источников" desc="Куки для закрытых разделов и зеркал. Пустое поле — работа без входа.">
        <SubHead>ExHentai (onion)</SubHead>
        <Row stack>
          <textarea
            className="cookie-input"
            rows={4}
            value={settings.onion_cookies_raw}
            placeholder="name=value по одной на строку"
            onChange={(e) => upd({ onion_cookies_raw: e.target.value })}
          />
        </Row>
        <Row>
          <button onClick={() => void doLogin('http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion', 'ExHentai onion')}>
            Войти в ExHentai (onion)
          </button>
        </Row>

        <SubHead>NHentai (onion)</SubHead>
        <Row stack>
          <textarea
            className="cookie-input"
            rows={4}
            value={settings.nhentai_onion_cookies_raw}
            placeholder="name=value по одной на строку"
            onChange={(e) => upd({ nhentai_onion_cookies_raw: e.target.value })}
          />
        </Row>
        <Row>
          <button onClick={() => void doLogin('http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion', 'NHentai onion')}>
            Войти в NHentai (onion)
          </button>
        </Row>

        <SubHead>NHentai (clearnet)</SubHead>
        <Row stack>
          <textarea
            className="cookie-input"
            rows={4}
            value={settings.nhentai_cookies_raw}
            placeholder="name=value по одной на строку"
            onChange={(e) => upd({ nhentai_cookies_raw: e.target.value })}
          />
        </Row>
        <Row>
          <button onClick={() => void doLogin('https://nhentai.net', 'NHentai')}>Войти в NHentai</button>
        </Row>
        <Row label="Onion base" note="Адрес onion-зеркала NHentai. Пусто — встроенный по умолчанию.">
          <input
            className="text-input"
            value={settings.nhentai_onion_base}
            placeholder="http://...onion"
            onChange={(e) => upd({ nhentai_onion_base: e.target.value })}
          />
          <button title="Вернуть встроенный адрес" onClick={() => upd({ nhentai_onion_base: '' })}>
            Сброс
          </button>
        </Row>

        <SubHead>Senkuro</SubHead>
        <Row stack note="Вход идёт через SSO Senkuro: откроется окно, где нужно нажать «Войти».">
          <textarea
            className="cookie-input"
            rows={4}
            value={settings.senkuro_cookies_raw}
            placeholder="name=value по одной на строку"
            onChange={(e) => upd({ senkuro_cookies_raw: e.target.value })}
          />
        </Row>
        <Row>
          <button onClick={() => void doLogin('https://senkuro.me/', 'Senkuro')}>Войти в Senkuro</button>
        </Row>
        {loginMsg && (
          <Row stack>
            <span className="set-note">{loginMsg}</span>
          </Row>
        )}
      </Section>
    </>
  );
}
