import { memo } from 'react'
import type { CatalogCard } from '@shared/ipc'

interface Props {
  cards: CatalogCard[]
  onSelect: (card: CatalogCard) => void
  progress?: Record<string, [number, number]>
  onContextMenu?: (e: React.MouseEvent, card: CatalogCard) => void
}

function coverSrc(url: string): string {
  return `manga://cover/${encodeURIComponent(url)}`
}

function kindColor(kind: string | undefined): string {
  switch ((kind ?? '').toLowerCase()) {
    case 'doujinshi': return '#f02e2e'
    case 'manga': return '#f38a24'
    case 'artist cg': return '#d5a311'
    case 'game cg': return '#308430'
    case 'western': return '#8f8f00'
    case 'non-h': return '#1a9dc0'
    case 'image set': return '#2e54c4'
    case 'cosplay': return '#6e2ec4'
    case 'asian porn': return '#c42e8e'
    case 'misc': return '#606060'
    case 'манга': return '#f38a24'
    case 'манхва': return '#d5a311'
    case 'маньхуа': return '#1a9dc0'
    default: return '#505050'
  }
}

interface CardProps {
  card: CatalogCard
  progressEntry?: [number, number]
  onSelect: (card: CatalogCard) => void
  onContextMenu?: (e: React.MouseEvent, card: CatalogCard) => void
}

/** Memoized so appending a page (a new `cards` array) does not re-render the
 * already-rendered cards — only the newly added ones mount. */
const MangaCard = memo(function MangaCard({ card, progressEntry, onSelect, onContextMenu }: CardProps): JSX.Element {
  const count = card.chapterCount != null
    ? `${card.chapterCount} гл.`
    : card.pages != null ? `${card.pages} стр.` : ''
  return (
    <div
      className="manga-card"
      onClick={() => onSelect(card)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, card) : undefined}
    >
      <div className="manga-cover">
        {card.coverUrl
          ? <img src={coverSrc(card.coverUrl)} alt={card.title} loading="lazy" />
          : <div className="cover-placeholder" />}
        {card.kind && (
          <span className="manga-badge" style={{ background: kindColor(card.kind) }}>{card.kind}</span>
        )}
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
      <div className="manga-title" title={card.title}>{card.title}</div>
      <div className="manga-meta">
        <span className="manga-count">{count}</span>
        {card.score != null && <span className="score">★ {card.score.toFixed(1)}</span>}
      </div>
    </div>
  )
})

function MangaCardGrid({ cards, onSelect, progress, onContextMenu }: Props): JSX.Element {
  return (
    <div className="catalog-grid">
      {cards.map((c) => (
        <MangaCard
          key={c.url}
          card={c}
          progressEntry={progress?.[c.url]}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  )
}

export default memo(MangaCardGrid)
