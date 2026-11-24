import { useEffect, useRef, useState } from 'react';
import type { EhGalleryInfo, EhTorrent } from '@shared/ipc';
import { errorText } from '../../lib/errors';
import { useBodyScrollLock, useDialogFocus } from '../../lib/use-modal';

interface Props {
  url: string;
  onClose: () => void;
}

type Tab = 'info' | 'torrents' | 'hath';

/** E-Hentai gallery extras: metadata/tags/comments (JHenTai's details page),
 * torrents popup and the H@H download request. All read-only. */
export default function EhInfoModal({ url, onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('info');
  const [info, setInfo] = useState<EhGalleryInfo | null>(null);
  const [torrents, setTorrents] = useState<EhTorrent[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [torrentErr, setTorrentErr] = useState<string | null>(null);
  const [res, setRes] = useState('org');
  const [hathBusy, setHathBusy] = useState(false);
  const [hathMsg, setHathMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useDialogFocus(onClose, closeRef);
  useBodyScrollLock();

  useEffect(() => () => {
    if (copiedTimer.current != null) clearTimeout(copiedTimer.current);
  }, []);

  useEffect(() => {
    let live = true;
    setBusy(true);
    setErr(null);
    (async () => {
      try {
        const i = await window.api.ehGalleryInfo(url);
        if (live) setInfo(i);
      } catch (e) {
        if (live) setErr(errorText(e));
      } finally {
        if (live) setBusy(false);
      }
      try {
        const t = await window.api.ehTorrents(url);
        if (live) setTorrents(t);
      } catch (e) {
        if (live) setTorrentErr(errorText(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [url]);

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      if (copiedTimer.current != null) clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  };

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="overlay-card"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="eh-info-title"
        style={{ maxWidth: 760, width: '92%', maxHeight: '82vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <strong id="eh-info-title" style={{ flex: 1 }}>ExHentai: информация</strong>
          {(['info', 'torrents', 'hath'] as Tab[]).map((t) => (
            <button key={t} type="button" className={tab === t ? 'set-primary' : undefined} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t === 'info' ? 'Инфо' : t === 'torrents' ? 'Торренты' : 'H@H'}
            </button>
          ))}
          <button ref={closeRef} type="button" onClick={onClose}>Закрыть</button>
        </div>

        {tab === 'info' &&
          (busy ? (
            <p className="set-note">Загружаю…</p>
          ) : err ? (
            <p className="set-note">Ошибка: {err}</p>
          ) : info ? (
            <div style={{ fontSize: 13, lineHeight: 1.45 }}>
              <p>
                <strong>{info.title}</strong>
              </p>
              <p className="set-note">
                {info.uploader && <>Загрузил: {info.uploader} · </>}
                {info.posted && <>Опубликовано: {info.posted} · </>}
                {info.rating !== null && (
                  <>
                    Рейтинг: {info.rating.toFixed(2)}
                    {info.ratingCount ? ` (${info.ratingCount})` : ''} ·{' '}
                  </>
                )}
                {info.language && <>Язык: {info.language} · </>}
                {info.fileSize && <>Размер: {info.fileSize}</>}
              </p>
              {info.tags.length > 0 && (
                <p style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {info.tags.map((t) => (
                    <span key={`${t.namespace}:${t.key}`} className="tag-chip" style={{ fontSize: 11 }}>
                      {t.namespace}:{t.key}
                    </span>
                  ))}
                </p>
              )}
              <p className="set-note">Комментарии ({info.comments.length}):</p>
              {info.comments.length === 0 && <p className="set-note">Комментариев нет.</p>}
              {info.comments.map((c, i) => (
                <p key={i} style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>
                  <span className="set-note">
                    {c.author}
                    {c.uploader ? ' (загрузивший)' : ''}:
                  </span>
                  <br />
                  {c.text}
                </p>
              ))}
            </div>
          ) : null)}

        {tab === 'torrents' &&
          (torrentErr ? (
            <p className="set-note">Ошибка: {torrentErr}</p>
          ) : torrents === null ? (
            <p className="set-note">Загружаю…</p>
          ) : torrents.length === 0 ? (
            <p className="set-note">Торрентов для этой галереи нет.</p>
          ) : (
            <div>
              {torrents.map((t, i) => (
                <div key={i} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
                  <div style={{ fontSize: 13, wordBreak: 'break-word' }}>{t.title}</div>
                  <div className="set-note" style={{ marginTop: 4 }}>
                    {t.size && <>Размер: {t.size} · </>}
                    Сиды: {t.seeds} · Пиры: {t.peers} · Скачали: {t.downloads}
                    {t.uploader && <> · {t.uploader}</>}
                    {t.posted && <> · {t.posted}</>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button
                      disabled={!t.magnet}
                      onClick={() => void copy(t.magnet)}
                      title={t.magnet || 'магнит отсутствует'}
                    >
                      {copied === t.magnet ? 'Скопировано' : 'Копировать магнит'}
                    </button>
                    <button disabled={!t.torrentUrl} onClick={() => void copy(t.torrentUrl)}>
                      {copied === t.torrentUrl ? 'Скопировано' : 'Копировать .torrent'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}

        {tab === 'hath' && (
          <div>
            <p className="set-note">
              H@H-скачивание запрашивает архив у H@H-клиентов. Нужен аккаунт с H@H/GP; результат приходит в H@H-клиент или
              на страницу сайта.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <select className="filter-select" value={res} onChange={(e) => setRes(e.target.value)}>
                <option value="org">Оригинал</option>
                <option value="1280">1280</option>
                <option value="980">980</option>
                <option value="780">780</option>
                <option value="640">640</option>
              </select>
              <button
                className="set-primary"
                disabled={hathBusy}
                onClick={async () => {
                  setHathBusy(true);
                  setHathMsg(null);
                  try {
                    const r = await window.api.ehHathDownload(url, res);
                    setHathMsg(r.message);
                  } catch (e) {
                    setHathMsg(`Ошибка: ${errorText(e)}`);
                  } finally {
                    setHathBusy(false);
                  }
                }}
              >
                {hathBusy ? 'Запрашиваю…' : 'Запросить H@H'}
              </button>
            </div>
            {hathMsg && <p className="set-note">{hathMsg}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
