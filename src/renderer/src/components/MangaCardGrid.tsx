import { memo } from 'react';
import type { CatalogCard } from '@shared/ipc';
import type { ReadingStatus } from '@shared/library';
import KindBadge from './KindBadge';
import StatusBadge from './StatusBadge';
import CoverImg from './CoverImg';

interface Props {
  cards: CatalogCard[];
  onSelect: (card: CatalogCard) => void;
  progress?: Record<string, [number, number]>;
  statuses?: Record<string, ReadingStatus>;
  onContextMenu?: (e: React.MouseEvent, card: CatalogCard) => void;
}

interface CardProps {
  card: CatalogCard;
  progressEntry?: [number, number];
  status?: ReadingStatus;
  onSelect: (card: CatalogCard) => void;
  onContextMenu?: (e: React.MouseEvent, card: CatalogCard) => void;
}

/** Memoized so appending a page (a new `cards` array) does not re-render the
 * already-rendered cards — only the newly added ones mount. */
const MangaCard = memo(function MangaCard({ card, progressEntry, status, onSelect, onContextMenu }: CardProps): JSX.Element {
  const count = card.chapterCount != null ? `${card.chapterCount} гл.` : card.pages != null ? `${card.pages} стр.` : '';
  return (
    <div className="manga-card" onClick={() => onSelect(card)} onContextMenu={onContextMenu ? (e) => onContextMenu(e, card) : undefined}>
      <div className="manga-cover">
        <CoverImg url={card.coverUrl} alt={card.title} />
        {card.kind && <KindBadge kind={card.kind} />}
        {card.adult && (
          <span className="manga-badge adult-badge" title="18+">
            18+
          </span>
        )}
        <StatusBadge status={status} />
        {progressEntry && (
          <div className="manga-progress">
            <div className="manga-progress-track">
              <div
                className="manga-progress-fill"
                style={{ width: `${progressEntry[1] > 0 ? Math.min(100, (progressEntry[0] / progressEntry[1]) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>
      <div className="manga-title" title={card.title}>
        {card.title}
      </div>
      <div className="manga-meta">
        <span className="manga-count">{count}</span>
        {card.score != null && <span className="score">★ {card.score.toFixed(1)}</span>}
      </div>
    </div>
  );
});

function MangaCardGrid({ cards, onSelect, progress, statuses, onContextMenu }: Props): JSX.Element {
  return (
    <div className="catalog-grid">
      {cards.map((c) => (
        <MangaCard
          key={c.url}
          card={c}
          progressEntry={progress?.[c.url]}
          status={statuses?.[c.url]}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

export default memo(MangaCardGrid);
