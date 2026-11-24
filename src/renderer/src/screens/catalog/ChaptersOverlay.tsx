import { useEffect, useRef, useState } from 'react';
import type { CatalogCard } from '@shared/ipc';
import { SOURCES } from './constants';
import type { CatalogSearch } from './useCatalogSearch';
import { tagChipStyle } from '../../lib/tag-colors';
import { errorText } from '../../lib/errors';
import { useBodyScrollLock, useDialogFocus } from '../../lib/use-modal';

/** Tags for the current work. MangaDex/E-Hentai deliver them with the listing;
 * nhentai only has them on the gallery page, so they are fetched once when the
 * menu opens. */
function OverlayTags({ url, initial }: { url: string; initial?: string[] }): JSX.Element | null {
  const [tags, setTags] = useState<string[]>(initial ?? []);
  useEffect(() => {
    const seeded = initial ?? [];
    setTags(seeded);
    if (seeded.length > 0) return;
    if (!/nhentai|senkuro|manga-shi/i.test(url)) return;
    let cancelled = false;
    void window.api
      .catalogTags(url)
      .then((t) => {
        if (!cancelled) setTags(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url, initial]);

  if (tags.length === 0) return null;
  return (
    <div className="overlay-tags" title={tags.join(', ')}>
      {tags.slice(0, 40).map((t) => (
        <span key={t} className="overlay-tag" style={tagChipStyle(t)}>
          {t}
        </span>
      ))}
      {tags.length > 40 && <span className="overlay-tag more">+{tags.length - 40}</span>}
    </div>
  );
}

function ChaptersDialog({ s, picked }: { s: CatalogSearch; picked: CatalogCard }): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus(() => s.closeChapters(), closeRef);
  useBodyScrollLock();
  // Feedback lives in the overlay: the toolbar notice was rendered UNDER the
  // overlay (z-index) and stuck there forever after closing it.
  const [addBusy, setAddBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  useEffect(() => {
    setAddBusy(false);
    setAdded(false);
    setAddError(null);
  }, [picked.url]);

  const sourceLabel = SOURCES.find((x) => x.key === s.source)?.label ?? '';
  const chapters = s.chapters;

  const addToLibrary = async (): Promise<void> => {
    if (addBusy || added) return;
    setAddBusy(true);
    setAddError(null);
    try {
      let adult = picked.adult;
      if (adult === undefined) {
        try {
          const resolved = await window.api.catalogAdultBatch([picked.url]);
          adult = resolved[picked.url] === true;
        } catch {
          /* keep undefined */
        }
      }
      await window.api.libraryAdd({
        url: picked.url,
        title: picked.title,
        coverUrl: picked.coverUrl,
        source: sourceLabel,
        seriesId: picked.url,
        adult: adult === true,
      });
      setAdded(true);
    } catch (e) {
      setAddError(errorText(e));
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={() => s.closeChapters()}>
      <div
        ref={dialogRef}
        className="overlay-card chapters"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chapters-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overlay-head">
          <h3 id="chapters-dialog-title" className="overlay-title" title={picked.title}>
            {picked.title}
          </h3>
          <button ref={closeRef} className="overlay-close" aria-label="Закрыть" title="Закрыть" onClick={() => s.closeChapters()}>
            ×
          </button>
        </div>

        <div className="overlay-meta">
          {sourceLabel && <span className="overlay-chip">{sourceLabel}</span>}
          {picked.status && <span className="overlay-chip overlay-status">{picked.status}</span>}
          {chapters ? (
            <span>Глав: {chapters.length}</span>
          ) : s.chapterError ? (
            <span>Не удалось загрузить главы</span>
          ) : (
            <span>Загружаю список…</span>
          )}
        </div>

        <OverlayTags url={picked.url} initial={picked.tags} />
        <div className="chapter-list">
          {s.opening && <div className="overlay-note">Открываю главу…</div>}
          {s.chapterError && (
            <div className="overlay-note">
              <div className="error-text">{s.chapterError}</div>
              <button className="btn-secondary" onClick={() => void s.retryChapters()}>
                Повторить
              </button>
            </div>
          )}
          {!chapters && !s.chapterError && !s.opening && <div className="overlay-note">Загрузка глав…</div>}
          {chapters &&
            chapters.map((c, i) => {
              const isRead = s.settings.read_chapters.includes(c.chapter_id);
              const label = c.title ? `${c.chapter_num} — ${c.title}` : c.chapter_num;
              return (
                <div key={c.chapter_id} className={`chapter-row${isRead ? ' read' : ''}`}>
                  <button
                    className="chapter-item"
                    title={label}
                    disabled={s.opening}
                    onClick={() => void s.openChapter(c.chapter_id, i)}
                  >
                    <span className="chapter-num">{c.chapter_num}</span>
                    {c.title ? <span className="chapter-name">{c.title}</span> : null}
                  </button>
                  <button
                    className={`chapter-toggle${isRead ? ' on' : ''}`}
                    title={isRead ? 'Снять отметку «прочитано»' : 'Отметить прочитанной'}
                    aria-pressed={isRead}
                    onClick={() => void window.api.setChapterRead(c.chapter_id, !isRead)}
                  >
                    {isRead ? '✓' : ''}
                  </button>
                </div>
              );
            })}
        </div>

        <div className="overlay-actions">
          <button className="btn-secondary" disabled={addBusy || added} onClick={() => void addToLibrary()}>
            {added ? '✓ В библиотеке' : addBusy ? 'Добавляю…' : '+ В библиотеку'}
          </button>
          {addError && <span className="error-text">{addError}</span>}
          <button className="btn-ghost" onClick={() => s.closeChapters()}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChaptersOverlay({ s }: { s: CatalogSearch }): JSX.Element | null {
  if (!s.picked) return null;
  return <ChaptersDialog s={s} picked={s.picked} />;
}
