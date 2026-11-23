import { errorText } from '../../lib/errors';
import { useEffect, useState } from 'react';
import Section, { Row, SubHead } from './Section';
import Toggle from '../../components/Toggle';
import type { BridgeStatus, SenkuroImportProgress, SiteStatus, TorDiagnostics, TorStatus } from '@shared/ipc';
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
  const [circuitBusy, setCircuitBusy] = useState(false);
  const [circuitMsg, setCircuitMsg] = useState<string | null>(null);
  const [torInfo, setTorInfo] = useState<TorDiagnostics | null>(null);
  const [torInfoBusy, setTorInfoBusy] = useState(false);
  const [skgBusy, setSkgBusy] = useState(false);
  const refreshTorInfo = async (): Promise<void> => {
    setTorInfoBusy(true);
    try {
      setTorInfo(await window.api.torDiagnostics());
    } catch {
      /* diagnostics are best-effort */
    } finally {
      setTorInfoBusy(false);
    }
  };
  const [skgMsg, setSkgMsg] = useState<string | null>(null);
  const [skgProgress, setSkgProgress] = useState<SenkuroImportProgress | null>(null);
  const [skgMarkRead, setSkgMarkRead] = useState(true);
  const [rmUser, setRmUser] = useState('');
  const [rmPass, setRmPass] = useState('');
  const [rmBusy, setRmBusy] = useState(false);
  const [rmImportBusy, setRmImportBusy] = useState(false);
  const [rmMsg, setRmMsg] = useState<string | null>(null);

  useEffect(() => window.api.onSenkuroImportProgress((p) => setSkgProgress(p)), []);
  useEffect(() => {
    void refreshTorInfo();
    // Diagnostics are cheap; refresh when the section opens once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSkgImport = async (): Promise<void> => {
    setSkgBusy(true);
    setSkgMsg(null);
    setSkgProgress(null);
    try {
      const r = await window.api.senkuroImportBookmarks({ markRead: skgMarkRead });
      setSkgMsg(r.message);
    } catch (e: any) {
      setSkgMsg(`Ошибка импорта: ${errorText(e)}`);
    } finally {
      setSkgBusy(false);
      setSkgProgress(null);
    }
  };

  const runRemangaLogin = async (): Promise<void> => {
    setRmBusy(true);
    setRmMsg(null);
    try {
      const r = await window.api.remangaLogin({ user: rmUser, password: rmPass });
      setRmMsg(r.message);
      if (r.ok) setRmPass('');
    } catch (e: any) {
      setRmMsg(`Remanga: ${errorText(e)}`);
    } finally {
      setRmBusy(false);
    }
  };

  const runRemangaImport = async (): Promise<void> => {
    setRmImportBusy(true);
    setRmMsg(null);
    try {
      const r = await window.api.remangaImportBookmarks();
      setRmMsg(r.message);
    } catch (e: any) {
      setRmMsg(`Ошибка импорта Remanga: ${errorText(e)}`);
    } finally {
      setRmImportBusy(false);
    }
  };

  const remangaLogout = async (): Promise<void> => {
    try {
      await window.api.remangaLogout();
      setRmMsg('Вы вышли из Remanga.');
    } catch (e: any) {
      setRmMsg(`Remanga: ${errorText(e)}`);
    }
  };

  const toggleTorSite = (key: string, on: boolean): void => {    const set = new Set(settings.tor_proxied_sites);
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
      setLoginMsg(`${label}: ошибка — ${errorText(e)}`);
    }
  };

  const clearCookies = async (field: 'onion' | 'nhentai' | 'nhentai_onion' | 'senkuro', label: string): Promise<void> => {
    setLoginMsg(`${label}: очищаю куки…`);
    try {
      await window.api.clearSiteCookies(field);
      setLoginMsg(`${label}: куки очищены`);
    } catch (e: any) {
      setLoginMsg(`${label}: ошибка — ${errorText(e)}`);
    }
  };

  return (
    <>
      <Section title="Tor и сеть" desc="Встроенный Tor, мосты и адрес SOCKS-прокси.">
        <Row label="Domain Fronting" note="Доступ к ExHentai без VPN, когда DNS заблокирован.">
          <Toggle checked={settings.enable_domain_fronting} onChange={(v) => upd({ enable_domain_fronting: v })} />
        </Row>
        <Row
          label="Картинки EH напрямую"
          note="Скачивать изображения с CDN (ehgt/hath) без Tor — заметно быстрее, но CDN видит ваш реальный IP. Страницы галереи/каталога всё равно идут через Tor."
        >
          <Toggle checked={settings.eh_images_direct} onChange={(v) => upd({ eh_images_direct: v })} />
        </Row>
        <Row
          label="Оригиналы изображений EH"
          note="Читать полноразмерные оригиналы вместо ресайза 1280 px — резче на вебтунах и сканах, но больше трафика."
        >
          <Toggle checked={settings.eh_original_images} onChange={(v) => upd({ eh_original_images: v })} />
        </Row>
        <Row
          label="Кэш каталога EH"
          note="Сколько минут отдавать сохранённые страницы каталога ExHentai/E-Hentai (меньше запросов и банов). 0 — без кэша."
        >
          <input
            className="text-input"
            type="number"
            min={0}
            max={240}
            value={settings.eh_listing_cache_minutes}
            onChange={(e) => upd({ eh_listing_cache_minutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })}
          />
          <span className="set-note">мин</span>
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
        <Row
          label="Цепь Tor"
          note="Новый выходной узел без перезапуска Tor. Помогает, когда сайт ограничил IP выхода (clearnet). Для ExHentai через .onion бан привязан к аккаунту, а не к IP — там поможет другой аккаунт или ожидание."
        >
          <button
            disabled={circuitBusy || !settings.builtin_tor}
            onClick={async () => {
              setCircuitBusy(true);
              setCircuitMsg(null);
              try {
                const r = await window.api.newTorCircuit();
                setCircuitMsg(r.ok ? 'Цепь сменена — попробуй запрос снова' : 'Не удалось: встроенный Tor не запущен (используется внешний?)');
              } catch (e) {
                setCircuitMsg(`Ошибка: ${errorText(e)}`);
              } finally {
                setCircuitBusy(false);
              }
            }}
          >
            {circuitBusy ? 'Меняю…' : 'Сменить цепь Tor'}
          </button>
        </Row>
        {circuitMsg && (
          <Row stack>
            <span className="set-note">{circuitMsg}</span>
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
        <Row
          label="ExHentai"
          stack
          note="Прокси для ExHentai вне Tor: http://host:port или socks5://host:port (как в JHenTai). Пусто — напрямую/через domain fronting."
        >
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
          <button className="set-danger" onClick={() => void clearCookies('onion', 'ExHentai onion')}>
            Очистить куки
          </button>
        </Row>
        <Row stack>
          <span className="set-note">
            На onion-зеркале сессия хранится в одной cookie <code>onikakushi</code> — это нормально, отдельных
            ipb_member_id / ipb_pass_hash / igneous тут не будет (они нужны только для обычного ExHentai). После входа
            значение меняется; если каталог пишет «пустая страница» — сессия истекла, войди заново и введи капчу.
          </span>
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
          <button className="set-danger" onClick={() => void clearCookies('nhentai_onion', 'NHentai onion')}>
            Очистить куки
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
          <button className="set-danger" onClick={() => void clearCookies('nhentai', 'NHentai')}>
            Очистить куки
          </button>
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

        <Row label="Состояние Tor" note="Bootstrap, построенные цепи и выходы — для диагностики медленных запросов.">
          <button onClick={() => void refreshTorInfo()}>{torInfoBusy ? 'Проверяю…' : 'Обновить'}</button>
        </Row>
        {torInfo && (
          <Row stack>
            <span className="set-note">
              {torInfo.running ? 'Tor запущен' : 'Tor не запущен'}
              {torInfo.bootstrap ? ` · bootstrap ${torInfo.bootstrap}` : ''}
              {` · цепей: ${torInfo.circuits}`}
              {torInfo.exits.length > 0 ? ` · выходов: ${torInfo.exits.length}` : ''}
              {` · мостов: ${torInfo.bridgeCount}`}
            </span>
            {torInfo.bridgeCount === 1 && (
              <span className="set-note" style={{ color: '#e0a040' }}>
                Tor рекомендует минимум два моста (conflux/резерв). Добавь второй мост в списке ниже.
              </span>
            )}
          </Row>
        )}        <SubHead>Senkuro</SubHead>
        <Row
          stack
          note="Вход идёт через страницу авторизации Senkuro SSO (PKCE OAuth) — главная сайта не открывается. Если сеть блокирует один из SSO-хостов, окно само попробует второй."
        >
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
          <button className="set-danger" onClick={() => void clearCookies('senkuro', 'Senkuro')}>
            Очистить куки
          </button>
        </Row>
        <SubHead>Библиотека Senkuro (Senkognito)</SubHead>
        <Row
          stack
          note="Импортирует закладки «Читаю / В планах / Прочитано / Любимое / Отложено / Брошено» с прогрессом (на какой главе остановился) и отметками прочитанных глав. Используется тот же аккаунт Senkuro. Отметки читаного хранятся до 4000 последних глав (до 40 на произведение)."
        >
          <label className="filter-check">
            <input type="checkbox" checked={skgMarkRead} onChange={(e) => setSkgMarkRead(e.target.checked)} />
            отмечать прочитанные главы
          </label>
        </Row>
        <Row>
          <button className="set-primary" disabled={skgBusy} onClick={() => void runSkgImport()}>
            {skgBusy ? 'Импортирую…' : 'Импортировать закладки Senkuro'}
          </button>
        </Row>
        {skgBusy && skgProgress && (
          <Row stack>
            <span className="set-note">
              {skgProgress.phase === 'bookmarks'
                ? `Загружаю закладки: ${skgProgress.done}`
                : skgProgress.phase === 'saving'
                  ? 'Сохраняю…'
                  : `Обрабатываю ${skgProgress.done}/${skgProgress.total}${skgProgress.title ? ` — ${skgProgress.title}` : ''}`}
            </span>
          </Row>
        )}
        {skgMsg && (
          <Row stack>
            <span className="set-note">{skgMsg}</span>
          </Row>
        )}
        {loginMsg && (
          <Row stack>
            <span className="set-note">{loginMsg}</span>
          </Row>
        )}
        <SubHead>Библиотека Remanga</SubHead>
        {settings.remanga_user_id == null ? (
          <>
            <Row label="Логин/почта" note="Вход напрямую в Remanga. Пароль не сохраняется — только токен сессии.">
              <input
                className="set-input"
                value={rmUser}
                onChange={(e) => setRmUser(e.target.value)}
                placeholder="nickname или email"
                autoComplete="username"
              />
            </Row>
            <Row label="Пароль">
              <input
                className="set-input"
                type="password"
                value={rmPass}
                onChange={(e) => setRmPass(e.target.value)}
                autoComplete="current-password"
              />
            </Row>
            <Row>
              <button className="set-primary" disabled={rmBusy || !rmUser.trim() || !rmPass} onClick={() => void runRemangaLogin()}>
                {rmBusy ? 'Вхожу…' : 'Войти в Remanga'}
              </button>
            </Row>
          </>
        ) : (
          <>
            <Row label="Аккаунт" note={`Вы вошли как ${settings.remanga_username || settings.remanga_user_id}. Импорт забирает «Читаю / В планах / Прочитано / Отложено / Брошено» с последней главой.`}>
              <button className="set-primary" disabled={rmImportBusy} onClick={() => void runRemangaImport()}>
                {rmImportBusy ? 'Импортирую…' : 'Импортировать закладки Remanga'}
              </button>
              <button className="set-danger" onClick={() => void remangaLogout()}>
                Выйти
              </button>
            </Row>
            <Row stack>
              <span className="set-note">
                При совпадении названий с другим источником карточка показывает максимальное число прочитанных глав, а в карточке произведения можно выбрать источник.
              </span>
            </Row>
          </>
        )}
        {rmMsg && (
          <Row stack>
            <span className="set-note">{rmMsg}</span>
          </Row>
        )}
      </Section>
    </>
  );
}
