import { SOURCES } from './constants';
import type { CatalogSearch } from './useCatalogSearch';

export default function ChaptersOverlay({ s }: { s: CatalogSearch }): JSX.Element | null {
  const { picked } = s;
  if (!picked) return null;
  return (
    <div className="overlay" onClick={() => s.setPicked(null)}>
      <div className="overlay-card chapters" onClick={(e) => e.stopPropagation()}>
        <h3>{picked.title}</h3>
        <button
          onClick={() =>
            void (async () => {
              await window.api.libraryAdd({
                url: picked.url,
                title: picked.title,
                coverUrl: picked.coverUrl,
                source: SOURCES.find((x) => x.key === s.source)?.label ?? '',
                seriesId: picked.url,
              });
              s.setExNotice('Добавлено в библиотеку');
            })()
          }
        >
          ＋ В библиотеку
        </button>
        <div className="chapter-list">
          {s.opening && <div className="muted">Открываю главу…</div>}
          {s.chapterError && <div className="error-text">{s.chapterError}</div>}
          {!s.chapters && !s.chapterError && <div>Загрузка…</div>}
          {s.chapters && <div className="chapter-count muted">Всего глав: {s.chapters.length}</div>}
          {s.chapters &&
            s.chapters.map((c, i) => {
              const isRead = s.settings.read_chapters.includes(c.chapter_id);
              return (
                <button
                  key={c.chapter_id}
                  className={`chapter-item${isRead ? ' read' : ''}`}
                  onClick={() => void s.openChapter(c.chapter_id, i)}
                >
                  {isRead ? '✓ ' : ''}
                  {c.title ? `${c.chapter_num} — ${c.title}` : c.chapter_num}
                </button>
              );
            })}
        </div>
        <button onClick={() => s.setPicked(null)}>Закрыть</button>
      </div>
    </div>
  );
}
