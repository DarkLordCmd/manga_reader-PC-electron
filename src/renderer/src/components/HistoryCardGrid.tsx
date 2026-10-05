import type { HistoryEntry } from '@shared/types'

interface Props {
  entries: HistoryEntry[]
  onContinue: (e: HistoryEntry) => void
  onAddToLibrary?: (e: HistoryEntry) => void
}

function coverSrc(url: string): string {
  return `manga://cover/${encodeURIComponent(url)}`
}

export default function HistoryCardGrid({ entries, onContinue, onAddToLibrary }: Props): JSX.Element {
  return (
    <div className="history-grid">
      {entries.map((e) => {
        const btnLabel = e.current_page > 1 ? '▶ Продолжить' : '▶ Открыть'
        const chapterFrac = e.total_pages > 0 ? Math.min(1, e.current_page / e.total_pages) : 0
        const seriesFrac =
          e.chapter_index != null && e.chapter_total != null && e.chapter_total > 0
            ? Math.min(1, (e.chapter_index + 1) / e.chapter_total)
            : null
        const meta = [e.source, e.chapter_label != null ? `гл. ${e.chapter_label}` : null]
          .filter(Boolean).join(' · ')
        return (
          <div key={e.series_id} className="history-card" onClick={() => onContinue(e)}>
            <div className="history-cover">
              {e.cover_url
                ? <img src={coverSrc(e.cover_url)} alt="" loading="lazy" />
                : <div className="cover-placeholder" />}
            </div>
            <div className="history-title" title={e.title}>{e.title || 'Без названия'}</div>
            <div className="history-meta">
              <span>{meta}</span>
              <button
                className="continue-btn"
                onClick={(ev) => { ev.stopPropagation(); onContinue(e) }}
              >{btnLabel}</button>
              {onAddToLibrary && (
                <button className="continue-btn" onClick={(ev) => { ev.stopPropagation(); onAddToLibrary(e) }}>＋</button>
              )}
            </div>
            <div className="history-bars">
              <div className="bar-track"><div className="bar-fill chapter" style={{ width: `${chapterFrac * 100}%` }} /></div>
              {seriesFrac != null && (
                <div className="bar-track"><div className="bar-fill series" style={{ width: `${seriesFrac * 100}%` }} /></div>
              )}
              <div className="bar-label muted">
                {seriesFrac != null
                  ? `стр. ${e.current_page}/${e.total_pages} · гл. ${(e.chapter_index ?? 0) + 1}/${e.chapter_total ?? 0}`
                  : `стр. ${e.current_page}/${e.total_pages}`}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}