import type { CatalogCard } from '@shared/ipc'

interface Props {
  cards: CatalogCard[]
  onSelect: (card: CatalogCard) => void
  progress?: Record<string, [number, number]>
}

function coverSrc(url: string): string {
  return `manga://cover/${encodeURIComponent(url)}`
}

export default function MangaCardGrid({ cards, onSelect, progress }: Props): JSX.Element {
  return (
    <div className="catalog-grid">
      {cards.map((c, i) => {
        const p = progress?.[c.url]
        return (
          <div key={`${c.url}-${i}`} className="manga-card" onClick={() => onSelect(c)}>
            <div className="manga-cover">
              {c.coverUrl
                ? <img src={coverSrc(c.coverUrl)} alt={c.title} loading="lazy" />
                : <div className="cover-placeholder" />}
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
              <span>{c.kind ?? (c.pages != null ? `${c.pages} стр.` : '')}</span>
              {c.score != null && <span className="score">★ {c.score.toFixed(1)}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}