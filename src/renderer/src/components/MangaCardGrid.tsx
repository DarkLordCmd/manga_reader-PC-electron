import { memo } from 'react';
import type { CatalogCard } from '@shared/ipc';
import type { ReadingStatus } from '@shared/library';
import KindBadge from './KindBadge';
import StatusBadge from './StatusBadge';
import CoverImg from './CoverImg';
import { normalizeUrl } from '../lib/status-map';

interface Props {
  cards: CatalogCard[];
  onSelect: (card: CatalogCard) => void;
  progress?: Record<string, [number, number]>;
  statuses?: Record<string, ReadingStatus>;
  onContextMenu?: (e: React.MouseEvent, card: CatalogCard) => void;
  /** Blur covers of 18+ works (privacy setting). */
  blurAdult?: boolean;
}

interface CardProps {
  card: CatalogCard;
  progressEntry?: [number, number];
  status?: ReadingStatus;
  onSelect: (card: CatalogCard) => void;
  onContextMenu?: (e: React.MouseEvent, card: CatalogCard) => void;
  blurAdult?: boolean;
}

/** Memoized so appending a page (a new `cards` array) does not re-render the
 * already-rendered cards — only the newly added ones mount. */
const MangaCard = memo(function MangaCard({ card, progressEntry, status, onSelect, onContextMenu, blurAdult }: CardProps): JSX.Element {
  const count = card.chapterCount != null ? `${card.chapterCount} гл.` : card.pages != null ? `${card.pages} стр.` : '';
  return (
    <div
      className="manga-card"
      role="button"
      tabIndex={0}
      aria-label={`Открыть ${card.title}`}
      onClick={(e) => {
        const control = (e.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"], [tabindex]');
        if (control && control !== e.currentTarget) return;
        onSelect(card);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(card);
        }
      }}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, card) : undefined}
    >
      <div className="manga-cover">
        <CoverImg url={card.coverUrl} alt={card.title} className={blurAdult && (card.adult || card.age18) ? 'blur-adult' : undefined} />
        {card.kind && <KindBadge kind={card.kind} />}
        {(card.adult || card.age18) && (
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
        {card.status && <span className="manga-pub-status" title="Статус произведения">{card.status}</span>}
        {card.score != null && <span className="score">★ {card.score.toFixed(1)}</span>}
      </div>
    </div>
  );
});

function MangaCardGrid({ cards, onSelect, progress, statuses, onContextMenu, blurAdult }: Props): JSX.Element {
  const normalizedProgress = Object.fromEntries(Object.entries(progress ?? {}).map(([url, entry]) => [normalizeUrl(url), entry]));
  const normalizedStatuses = Object.fromEntries(Object.entries(statuses ?? {}).map(([url, status]) => [normalizeUrl(url), status]));
  return (
    <div className="catalog-grid">
      {cards.map((c) => {
        const cardUrl = normalizeUrl(c.url);
        return (
          <MangaCard
            key={c.url}
            card={c}
            progressEntry={normalizedProgress[cardUrl] ?? progress?.[c.url]}
            status={normalizedStatuses[cardUrl] ?? statuses?.[c.url]}
            blurAdult={blurAdult}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
          />
        );
      })}
    </div>
  );
}

export default memo(MangaCardGrid);
