import type { MangaCard } from '@shared/mangadex'

interface Props {
  cards: MangaCard[]
  onSelect: (card: MangaCard) => void
}

function coverSrc(url: string): string {
  return `manga://cover/${encodeURIComponent(url)}`
}

export default function MangaCardGrid({ cards, onSelect }: Props): JSX.Element {
  return (
    <div className="catalog-grid">
      {cards.map((c) => (
        <div key={c.manga_id} className="manga-card" onClick={() => onSelect(c)}>
          <div className="manga-cover">
            {c.cover_url
              ? <img src={coverSrc(c.cover_url)} alt={c.title} loading="lazy" />
              : <div className="cover-placeholder" />}
          </div>
          <div className="manga-title" title={c.title}>{c.title}</div>
          <div className="manga-meta">
            <span>{c.kind}</span>
            {c.score != null && <span className="score">★ {c.score.toFixed(1)}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}