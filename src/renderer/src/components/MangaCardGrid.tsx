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

export default function MangaCardGrid({ cards, onSelect, progress, onContextMenu }: Props): JSX.Element {
  return (
    <div className="catalog-grid">
      {cards.map((c, i) => {
        const p = progress?.[c.url]
        const count = c.chapterCount != null
          ? `${c.chapterCount} гл.`
          : c.pages != null ? `${c.pages} стр.` : ''
        return (
          <div
            key={`${c.url}-${i}`}
            className="manga-card"
            onClick={() => onSelect(c)}
            onContextMenu={onContextMenu ? (e) => onContextMenu(e, c) : undefined}
          >
            <div className="manga-cover">
              {c.coverUrl
                ? <img src={coverSrc(c.coverUrl)} alt={c.title} loading="lazy" />
                : <div className="cover-placeholder" />}
              {c.kind && (
                <span className="manga-badge" style={{ background: kindColor(c.kind) }}>{c.kind}</span>
              )}
              {p && (
                <div className="manga-progress">
                  <div className="manga-progress-track">
                    <div
                      className="manga-progress-fill"
                      style={{ width: `${p[1] > 0 ? Math.min(100, (p[0] / p[1]) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="manga-title" title={c.title}>{c.title}</div>
            <div className="manga-meta">
              <span className="manga-count">{count}</span>
              {c.score != null && <span className="score">★ {c.score.toFixed(1)}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}