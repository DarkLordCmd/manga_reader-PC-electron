import { useEffect, useState } from 'react';
import { SOURCES } from './constants';
import type { CatalogSearch } from './useCatalogSearch';
import { tagChipStyle } from '../../lib/tag-colors';

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

export default function ChaptersOverlay({ s }: { s: CatalogSearch }): JSX.Element | null {
  const { picked } = s;
  if (!picked) return null;
  const sourceLabel = SOURCES.find((x) => x.key === s.source)?.label ?? '';
  const chapters = s.chapters;
  return (
    <div className="overlay" onClick={() => s.setPicked(null)}>
      <div className="overlay-card chapters" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h3 className="overlay-title" title={picked.title}>
            {picked.title}
          </h3>
          <button className="overlay-close" aria-label="Закрыть" title="Закрыть" onClick={() => s.setPicked(null)}>
            ×
          </button>
        </div>

        <div className="overlay-meta">
          {sourceLabel && <span className="overlay-chip">{sourceLabel}</span>}
          {chapters ? <span>Глав: {chapters.length}</span> : <span>Загружаю список…</span>}
        </div>

        <OverlayTags url={picked.url} initial={picked.tags} />
        <div className="chapter-list">
          {s.opening && <div className="overlay-note">Открываю главу…</div>}
          {s.chapterError && <div className="error-text">{s.chapterError}</div>}
          {!chapters && !s.chapterError && !s.opening && <div className="overlay-note">Загрузка глав…</div>}
          {chapters &&
            chapters.map((c, i) => {
              const isRead = s.settings.read_chapters.includes(c.chapter_id);
              const label = c.title ? `${c.chapter_num} — ${c.title}` : c.chapter_num;
              return (
                <div key={c.chapter_id} className={`chapter-row${isRead ? ' read' : ''}`}>
                  <button className="chapter-item" title={label} onClick={() => void s.openChapter(c.chapter_id, i)}>
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
          <button
            className="btn-secondary"
            onClick={() =>
              void (async () => {
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
                s.setExNotice('Добавлено в библиотеку');
              })()
            }
          >
            + В библиотеку
          </button>
          <button className="btn-ghost" onClick={() => s.setPicked(null)}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
