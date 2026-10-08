import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../state/store';
import Toggle from '../components/Toggle';
import type { TorStatus, BridgeStatus, SiteStatus, LibMirrorStatus, CustomDnsStatus, ExAccountsResult } from '@shared/ipc';

// Display copy of the well-known blocker-circumvention DNS servers (main keeps
// its own copy in services/custom-dns.ts — node-only module).
const KNOWN_DNS_SERVERS: { name: string; server: string }[] = [
  { name: 'ComssDNS', server: '83.220.169.155' },
  { name: 'XboxDNS', server: '111.88.96.50' },
  { name: 'XboxDNS v2', server: '87.228.47.200' },
  { name: 'XboxDNS old', server: '176.99.11.77' },
  { name: 'MalwDNS', server: '84.21.189.133' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="settings-section">
      <h3 className="settings-heading">{title}</h3>
      {children}
    </div>
  );
}

const TOR_SITES: { key: string; label: string }[] = [
  { key: 'ehentai', label: 'E-Hentai' },
  { key: 'nhentai', label: 'NHentai' },
  { key: 'comx', label: 'Com-X' },
  { key: 'senkuro', label: 'Senkuro' },
  { key: 'mangashi', label: 'Manga-shi' },
  { key: 'remanga', label: 'Remanga' },
  { key: 'mangalib', label: 'Mangalib' },
];

const LIB_MIRRORS = ['img33.imgslib.link', 'img34.imgslib.link', 'img45.imgslib.link'];

export default function Settings(): JSX.Element {
  const { settings, setSettings } = useStore();
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const [torStatus, setTorStatus] = useState<TorStatus | null>(null);
  const [torChecking, setTorChecking] = useState(false);
  const [bridgeResults, setBridgeResults] = useState<BridgeStatus[] | null>(null);
  const [siteResults, setSiteResults] = useState<SiteStatus[] | null>(null);
  const [exAcc, setExAcc] = useState<ExAccountsResult>({ accounts: [], currentId: 0 });
  const [exName, setExName] = useState('');
  const [exMemberId, setExMemberId] = useState('');
  const [exPassHash, setExPassHash] = useState('');
  const [exIgneous, setExIgneous] = useState('');
  const [exNotice, setExNotice] = useState<string | null>(null);
  const [pwUser, setPwUser] = useState('');
  const [pwPass, setPwPass] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [ckMember, setCkMember] = useState('');
  const [ckHash, setCkHash] = useState('');
  const [ckIgneous, setCkIgneous] = useState('');
  const [ckVerify, setCkVerify] = useState(true);
  const [ckMsg, setCkMsg] = useState<string | null>(null);
  const [ckBusy, setCkBusy] = useState(false);
  const [ckText, setCkText] = useState('');
  const [ignMsg, setIgnMsg] = useState<string | null>(null);
  const [ignBusy, setIgnBusy] = useState(false);
  const [libMirrorResults, setLibMirrorResults] = useState<LibMirrorStatus[] | null>(null);
  const [libMirrorMsg, setLibMirrorMsg] = useState<string | null>(null);
  const [dnsResults, setDnsResults] = useState<CustomDnsStatus[] | null>(null);
  const [dnsMsg, setDnsMsg] = useState<string | null>(null);
  const [pinHas, setPinHas] = useState(false);
  const [pinCurrent, setPinCurrent] = useState('');
  const [pinNew, setPinNew] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [google, setGoogle] = useState<{ authed: boolean; email: string | null; configured?: boolean }>({ authed: false, email: null });
  const [syncState, setSyncState] = useState<import('@shared/sync').SyncState>({
    state: 'idle',
    lastSyncAt: null,
    email: null,
    lastError: null,
  });
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ files: number; bytes: number; maxBytes: number } | null>(null);
  const [cacheMb, setCacheMb] = useState(String(settings.cover_cache_mb));

  const refreshCacheInfo = useCallback(() => {
    void window.api
      .coverCacheInfo()
      .then(setCacheInfo)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCacheInfo();
  }, [refreshCacheInfo]);
  useEffect(() => {
    setCacheMb(String(settings.cover_cache_mb));
  }, [settings.cover_cache_mb]);

  const clearCoverCache = async (): Promise<void> => {
    if (!window.confirm('Очистить кэш обложек? Обложки будут загружены заново.')) return;
    await window.api.coverCacheClear();
    refreshCacheInfo();
  };

  useEffect(() => {
    window.api.getExAccounts().then(setExAcc);
    window.api.pinHasPin().then(setPinHas);
  }, []);

  // Auto-detect E-Hentai cookies from the clipboard on open (like JHenTai).
  useEffect(() => {
    navigator.clipboard
      ?.readText?.()
      .then((t) => {
        if (!t) return;
        window.api
          .parseCookieText(t)
          .then((p) => {
            if (p.ipbMemberId || p.ipbPassHash || p.igneous) {
              if (p.ipbMemberId) setCkMember(p.ipbMemberId);
              if (p.ipbPassHash) setCkHash(p.ipbPassHash);
              if (p.igneous) setCkIgneous(p.igneous);
            }
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    window.api.googleAuthStatus().then(setGoogle);
    window.api.syncGetState().then(setSyncState);
    return window.api.onSyncChanged(setSyncState);
  }, []);

  const upd = (patch: Partial<typeof settings>): void => setSettings({ ...settings, ...patch });

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

  const setNewPin = async (): Promise<void> => {
    setPinMsg(null);
    try {
      if (!/^\d{4,8}$/.test(pinNew)) {
        setPinMsg('PIN должен быть 4–8 цифр');
        return;
      }
      if (pinHas) {
        if (!/^\d{4,8}$/.test(pinCurrent)) {
          setPinMsg('Введи текущий PIN (4–8 цифр)');
          return;
        }
        const removed = await window.api.pinRemovePin(pinCurrent);
        if (!removed) {
          setPinMsg('Неверный текущий PIN');
          return;
        }
      }
      await window.api.pinSetPin(pinNew);
      setPinHas(true);
      setPinMsg('PIN установлен');
      setPinCurrent('');
      setPinNew('');
    } catch (e: any) {
      setPinMsg(`Ошибка: ${e?.message ?? e}`);
    }
  };

  const removePin = async (): Promise<void> => {
    setPinMsg(null);
    if (!/^\d{4,8}$/.test(pinCurrent)) {
      setPinMsg('Введи текущий PIN (4–8 цифр)');
      return;
    }
    const ok = await window.api.pinRemovePin(pinCurrent);
    if (ok) {
      setPinHas(false);
      setPinMsg('PIN удалён');
      setPinCurrent('');
    } else {
      setPinMsg('Неверный текущий PIN');
    }
  };

  return (
    <div className="screen">
      <div className="settings-scroll">
        <Section title="Reading">
          <div className="row">
            <label>Mode:</label>
            <select value={settings.reading_mode} onChange={(e) => upd({ reading_mode: e.target.value as 'Scroll' | 'Book' })}>
              <option value="Scroll">Scroll</option>
              <option value="Book">Book</option>
            </select>
          </div>
          {settings.reading_mode === 'Book' && (
            <>
              <div className="row">
                <label>Direction:</label>
                <select value={settings.book_direction} onChange={(e) => upd({ book_direction: e.target.value as 'Ltr' | 'Rtl' })}>
                  <option value="Rtl">RTL (manga)</option>
                  <option value="Ltr">LTR</option>
                </select>
              </div>
              <div className="row">
                <label>Pages per screen: {settings.pages_per_screen}</label>
                <input
                  type="range"
                  min={1}
                  max={2}
                  step={1}
                  value={settings.pages_per_screen}
                  onChange={(e) => upd({ pages_per_screen: Number(e.target.value) })}
                />
              </div>
              <div className="row">
                <label>Page margin: {settings.page_margin}</label>
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={1}
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
                type="range"
                min={0.3}
                max={1}
                step={0.01}
                value={settings.width_scale}
                onChange={(e) => upd({ width_scale: Number(e.target.value) })}
              />
            </div>
          )}
        </Section>

        <Section title="Каталог">
          <div className="row">
            <Toggle checked={settings.infinite_scroll} onChange={(v) => upd({ infinite_scroll: v })}>
              Бесконечная прокрутка каталога
            </Toggle>
          </div>
          <div className="row">
            <Toggle checked={settings.nhentai_show_page_counts} onChange={(v) => upd({ nhentai_show_page_counts: v })}>
              Показывать количество страниц в каталоге NHentai
            </Toggle>
          </div>
        </Section>

        <Section title="Display">
          <div className="row">
            <Toggle checked={settings.show_thumbnails} onChange={(v) => upd({ show_thumbnails: v })}>
              Show thumbnails
            </Toggle>
          </div>
          <div className="row">
            <label>Thumbnail size: {settings.thumb_size}</label>
            <input
              type="range"
              min={60}
              max={200}
              step={5}
              value={settings.thumb_size}
              onChange={(e) => upd({ thumb_size: Number(e.target.value) })}
            />
          </div>
        </Section>

        <Section title="Downloads">
          <div className="row">
            <label>Папка загрузок:</label>
            <span className="muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {settings.downloads_dir ?? 'по умолчанию (userData/downloads)'}
            </span>
            <button
              onClick={async () => {
                const dir = await window.api.downloadsPickDir();
                if (dir) upd({ downloads_dir: dir });
              }}
            >
              Выбрать папку
            </button>
          </div>
        </Section>

        <Section title="Lib зеркала">
          <div className="row">
            <label>Сервер изображений Lib:</label>
            <select
              value={settings.lib_image_server ?? ''}
              onChange={(e) => {
                upd({ lib_image_server: e.target.value || null });
                setLibMirrorMsg(null);
              }}
            >
              <option value="">Авто (как есть)</option>
              {LIB_MIRRORS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <button
              onClick={async () => {
                setLibMirrorMsg('Проверяю зеркала…');
                try {
                  setLibMirrorResults(await window.api.libMirrorsCheck());
                } finally {
                  setLibMirrorMsg(null);
                }
              }}
            >
              Проверить зеркала
            </button>
          </div>
          {libMirrorResults && (
            <div className="check-list">
              {libMirrorResults.map((r) => (
                <div key={r.host} className={`check-result ${r.ok ? 'ok' : 'bad'}`}>
                  {r.ok ? `✓ ${r.host} (${r.ms} мс)` : `✗ ${r.host} — ${r.error}`}
                </div>
              ))}
            </div>
          )}
          {libMirrorResults && (
            <div className="row">
              <button
                onClick={() => {
                  const best = libMirrorResults.filter((r) => r.ok).sort((a, b) => a.ms - b.ms)[0];
                  if (!best) {
                    setLibMirrorMsg('Ни одно зеркало недоступно');
                    return;
                  }
                  upd({ lib_image_server: best.host });
                  setLibMirrorMsg(`Применено зеркало: ${best.host}`);
                }}
              >
                Применить лучший
              </button>
            </div>
          )}
          {libMirrorMsg && <div className="row muted">{libMirrorMsg}</div>}
        </Section>

        <Section title="DNS обхода блокировок">
          <div className="row">
            <label>DNS серверы:</label>
            <input
              style={{ flex: 1, minWidth: 220 }}
              value={settings.custom_dns ?? ''}
              placeholder="IPv4 или DoH-URL (https://…), через пробел/запятую"
              onChange={(e) => {
                upd({ custom_dns: e.target.value || null });
                setDnsResults(null);
              }}
            />
          </div>
          <div className="row">
            <button
              onClick={() => {
                upd({ custom_dns: KNOWN_DNS_SERVERS.map((k) => k.server).join(', ') });
                setDnsResults(null);
              }}
            >
              Вставить популярные
            </button>
            <button
              onClick={() => {
                upd({ custom_dns: 'https://dns.comss.ru/dns-query, https://cloudflare-dns.com/dns-query, https://dns.google/resolve' });
                setDnsResults(null);
              }}
            >
              DoH (зашифрованный)
            </button>
            <button
              disabled={!(settings.custom_dns ?? '').trim()}
              onClick={async () => {
                setDnsMsg('Проверяю DNS…');
                try {
                  setDnsResults(await window.api.customDnsCheck());
                } finally {
                  setDnsMsg(null);
                }
              }}
            >
              Проверить DNS
            </button>
          </div>
          {dnsResults && (
            <div className="check-list">
              {dnsResults.map((r) => (
                <div key={r.server} className={`check-result ${r.ok ? 'ok' : 'bad'}`}>
                  {r.ok ? `✓ ${r.server} → ${r.ip} (${r.ms} мс)` : `✗ ${r.server} — не отвечает`}
                </div>
              ))}
            </div>
          )}
          {dnsMsg && <div className="row muted">{dnsMsg}</div>}
        </Section>

        <Section title="Библиотека">
          <div className="row">
            <Toggle checked={settings.library_auto_add} onChange={(v) => upd({ library_auto_add: v })}>
              Авто-добавлять открытые галереи в библиотеку
            </Toggle>
          </div>
        </Section>

        <Section title="Синхронизация (Google Drive)">
          {!google.authed ? (
            <>
              <div className="row">
                <button
                  disabled={google.configured === false}
                  onClick={async () => {
                    setSyncMsg('Открываю окно входа Google…');
                    try {
                      const r = await window.api.googleLogin();
                      setGoogle(r);
                      setSyncMsg('Вход выполнен');
                    } catch (e: any) {
                      setSyncMsg(`Ошибка: ${e?.message ?? e}`);
                    }
                  }}
                >
                  Войти через Google
                </button>
              </div>
              {google.configured === false && (
                <div className="row muted">Google-вход отключён: GOOGLE_CLIENT_SECRET не задан при сборке.</div>
              )}
              <div className="row muted">Синхронизирует библиотеку и прогресс через вашу папку Google Drive.</div>
            </>
          ) : (
            <>
              <div className="row">
                <label>Аккаунт:</label>
                <span className="muted">{google.email || '—'}</span>
              </div>
              <div className="row">
                <label>Последняя синхронизация:</label>
                <span className="muted">{syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleString() : 'ещё не было'}</span>
              </div>
              <div className="row">
                <Toggle checked={settings.sync_enabled} onChange={(v) => upd({ sync_enabled: v })}>
                  Включить синхронизацию
                </Toggle>
              </div>
              <div className="row">
                <Toggle checked={settings.sync_auto} onChange={(v) => upd({ sync_auto: v })}>
                  Авто-синхронизация
                </Toggle>
              </div>
              <div className="row">
                <button
                  disabled={syncState.state === 'syncing'}
                  onClick={async () => {
                    setSyncMsg('Синхронизирую…');
                    try {
                      await window.api.syncNow();
                      setSyncMsg('Готово');
                    } catch (e: any) {
                      setSyncMsg(`Ошибка: ${e?.message ?? e}`);
                    }
                  }}
                >
                  {syncState.state === 'syncing' ? 'Синхронизация…' : 'Синхронизировать сейчас'}
                </button>
                <button
                  onClick={async () => {
                    await window.api.googleLogout();
                    setGoogle({ authed: false, email: null });
                    setSyncMsg('Вы вышли из Google');
                  }}
                >
                  Выйти
                </button>
              </div>
            </>
          )}
          {syncState.lastError && <div className="row muted">Ошибка синка: {syncState.lastError}</div>}
          {syncMsg && <div className="row muted">{syncMsg}</div>}
        </Section>

        <Section title="Резервная копия">
          <div className="row">
            <Toggle checked={includeSecrets} onChange={setIncludeSecrets}>
              Включить секреты (куки, прокси, аккаунты)
            </Toggle>
          </div>
          <div className="row">
            <button
              onClick={async () => {
                const r = await window.api.backupExport(includeSecrets);
                setBackupMsg(r.canceled ? 'Экспорт отменён' : `Сохранено: ${r.path}`);
              }}
            >
              Экспорт
            </button>
            <button
              onClick={async () => {
                const s = await window.api.backupImport();
                setBackupMsg(
                  s
                    ? `Импорт: +${s.seriesAdded} серий, ${s.seriesUpdated} обновлено, аккаунтов +${s.accountsAdded}, загрузок +${s.downloadsMerged}`
                    : 'Импорт отменён или не удался',
                );
              }}
            >
              Импорт
            </button>
          </div>
          {backupMsg && <div className="row muted">{backupMsg}</div>}
        </Section>

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

        <Section title="Аккаунты ExHentai">
          <div className="row">
            <label>Вход по куки (E-Hentai/ExHentai):</label>
          </div>
          <div className="row">
            <textarea
              className="cookie-input"
              rows={2}
              value={ckText}
              placeholder="Вставь куки (например, из буфера обмена) и нажми «Распознать»"
              onChange={(e) => setCkText(e.target.value)}
            />
          </div>
          <div className="row">
            <button
              onClick={async () => {
                if (!ckText.trim()) return;
                const p = await window.api.parseCookieText(ckText);
                if (p.ipbMemberId) setCkMember(p.ipbMemberId);
                if (p.ipbPassHash) setCkHash(p.ipbPassHash);
                if (p.igneous) setCkIgneous(p.igneous);
                setCkText('');
              }}
            >
              Распознать
            </button>
            <button
              onClick={async () => {
                try {
                  const t = await navigator.clipboard?.readText?.();
                  if (t) {
                    const p = await window.api.parseCookieText(t);
                    if (p.ipbMemberId) setCkMember(p.ipbMemberId);
                    if (p.ipbPassHash) setCkHash(p.ipbPassHash);
                    if (p.igneous) setCkIgneous(p.igneous);
                  }
                } catch {
                  /* clipboard blocked */
                }
              }}
            >
              📋 Из буфера
            </button>
            <Toggle className="filter-check" checked={ckVerify} onChange={setCkVerify}>
              Проверять вход
            </Toggle>
          </div>
          <div className="row">
            <label>ipb_member_id</label>
            <input className="text-input" value={ckMember} onChange={(e) => setCkMember(e.target.value)} style={{ width: 180 }} />
          </div>
          <div className="row">
            <label>ipb_pass_hash</label>
            <input className="text-input" value={ckHash} onChange={(e) => setCkHash(e.target.value)} style={{ width: 220 }} />
          </div>
          <div className="row">
            <label>igneous (для ExHentai, необязательно)</label>
            <input className="text-input" value={ckIgneous} onChange={(e) => setCkIgneous(e.target.value)} style={{ width: 220 }} />
          </div>
          <div className="row">
            <button
              disabled={ckBusy}
              onClick={async () => {
                setCkBusy(true);
                setCkMsg(null);
                try {
                  const r = await window.api.cookieLogin({
                    ipbMemberId: ckMember,
                    ipbPassHash: ckHash,
                    igneous: ckIgneous || null,
                    verify: ckVerify,
                  });
                  setCkMsg(r.message);
                  if (r.ok) setExAcc(await window.api.getExAccounts());
                } catch (e: any) {
                  setCkMsg(`Ошибка: ${e?.message ?? e}`);
                } finally {
                  setCkBusy(false);
                }
              }}
            >
              🍪 Войти по куки
            </button>
            <button
              disabled={ignBusy}
              title="Получить igneous из Set-Cookie exhentai.org"
              onClick={async () => {
                setIgnBusy(true);
                setIgnMsg(null);
                try {
                  const r = await window.api.refreshIgneous();
                  setIgnMsg(r.message);
                  if (r.ok) setExAcc(await window.api.getExAccounts());
                } catch (e: any) {
                  setIgnMsg(`Ошибка: ${e?.message ?? e}`);
                } finally {
                  setIgnBusy(false);
                }
              }}
            >
              🔄 Получить igneous (доступ к EX)
            </button>
          </div>
          {(ckMsg || ignMsg) && <div className="row muted">{ckMsg ?? ignMsg}</div>}
          <div className="row">
            <label>Вход по логину/паролю (E-Hentai):</label>
          </div>
          <div className="row">
            <input
              className="text-input"
              placeholder="Логин"
              value={pwUser}
              onChange={(e) => setPwUser(e.target.value)}
              style={{ width: 160 }}
            />
            <input
              className="text-input"
              type="password"
              placeholder="Пароль"
              value={pwPass}
              onChange={(e) => setPwPass(e.target.value)}
              style={{ width: 160 }}
            />
            <button
              disabled={pwBusy}
              onClick={async () => {
                setPwBusy(true);
                setPwMsg(null);
                try {
                  const r = await window.api.loginPassword(pwUser, pwPass);
                  setPwMsg(r.message);
                  if (r.ok) {
                    setPwPass('');
                    setExAcc(await window.api.getExAccounts());
                  }
                } catch (e: any) {
                  setPwMsg(`Ошибка: ${e?.message ?? e}`);
                } finally {
                  setPwBusy(false);
                }
              }}
            >
              🔑 Войти
            </button>
          </div>
          {pwMsg && <div className="row muted">{pwMsg}</div>}
          <div className="row">
            <label>Активный аккаунт используется для всех запросов к ExHentai (обычный режим).</label>
          </div>
          {exAcc.accounts.length === 0 && <div className="row muted">Нет ни одного аккаунта.</div>}
          {exAcc.accounts.map((a) => (
            <div className="row" key={a.id}>
              <button
                className={a.id === exAcc.currentId ? 'tab active' : 'tab'}
                onClick={() => void window.api.setExAccount(a.id).then(setExAcc)}
              >
                {a.name}
              </button>
              <button
                className="icon-btn"
                title="Удалить аккаунт"
                onClick={async () => {
                  setExAcc(await window.api.removeExAccount(a.id));
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="row">
            <button
              onClick={() =>
                void (async () => {
                  const r = await window.api.importExAccounts();
                  if (r) {
                    setExAcc(r.accounts);
                    setExNotice(r.count > 0 ? `Импортировано аккаунтов: ${r.count}` : 'В файле не найдено аккаунтов');
                  }
                })()
              }
            >
              📂 Импортировать пул (Share, storage.json)
            </button>
            <button
              onClick={async () => {
                const r = await window.api.addExAccount(exName, exMemberId, exPassHash, exIgneous);
                setExAcc(r);
                setExNotice(`Добавлен аккаунт (${r.currentId ? r.accounts.find((a) => a.id === r.currentId)?.name : ''})`);
                setExName('');
                setExMemberId('');
                setExPassHash('');
                setExIgneous('');
              }}
            >
              ＋ Добавить аккаунт вручную
            </button>
          </div>
          {exNotice && <div className="row muted">{exNotice}</div>}
          <div className="row">
            <label>Название (необязательно)</label>
            <input className="text-input" value={exName} onChange={(e) => setExName(e.target.value)} />
          </div>
          <div className="row">
            <label>ipb_member_id</label>
            <input className="text-input" value={exMemberId} onChange={(e) => setExMemberId(e.target.value)} />
          </div>
          <div className="row">
            <label>ipb_pass_hash</label>
            <input className="text-input" value={exPassHash} onChange={(e) => setExPassHash(e.target.value)} />
          </div>
          <div className="row">
            <label>igneous (только для ExHentai)</label>
            <input className="text-input" value={exIgneous} onChange={(e) => setExIgneous(e.target.value)} />
          </div>
        </Section>

        <Section title="🗄️ Кэш обложек">
          <div className="row">
            <label>Максимальный размер (МБ):</label>
            <input
              className="text-input"
              type="number"
              min={16}
              max={8192}
              step={16}
              value={cacheMb}
              onChange={(e) => setCacheMb(e.target.value)}
              onBlur={() => {
                const n = Math.round(Number(cacheMb));
                const v = Number.isFinite(n) ? Math.max(16, Math.min(8192, n)) : 256;
                setCacheMb(String(v));
                if (v !== settings.cover_cache_mb) upd({ cover_cache_mb: v });
              }}
            />
          </div>
          <div className="row">
            <button onClick={() => void clearCoverCache()}>🗑 Очистить кэш обложек</button>
            {cacheInfo && (
              <span className="muted">
                Занято {(cacheInfo.bytes / 1048576).toFixed(1)} МБ · {cacheInfo.files} файлов
              </span>
            )}
          </div>
        </Section>

        <Section title="🔒 Приватность">
          <div className="row">
            <Toggle checked={settings.show_r34_history} onChange={(v) => upd({ show_r34_history: v })}>
              Показывать контент R34 (источники каталога, «Популярное», вкладки R34)
            </Toggle>
          </div>
        </Section>

        <Section title="Security">
          <div className="row">
            <label>PIN-блокировка приложения:</label>
            <span className="muted">{pinHas ? 'включена' : 'не установлен'}</span>
          </div>
          {pinHas && (
            <div className="row">
              <label>Текущий PIN:</label>
              <input
                className="text-input"
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinCurrent}
                onChange={(e) => setPinCurrent(e.target.value)}
              />
            </div>
          )}
          <div className="row">
            <label>Новый PIN (4–8 цифр):</label>
            <input
              className="text-input"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pinNew}
              onChange={(e) => setPinNew(e.target.value)}
            />
            <button onClick={() => void setNewPin()}>Установить</button>
            {pinHas && <button onClick={() => void removePin()}>Удалить PIN</button>}
          </div>
          {pinMsg && <div className="row muted">{pinMsg}</div>}
        </Section>
      </div>
    </div>
  );
}
