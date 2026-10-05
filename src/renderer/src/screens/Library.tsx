import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { LibraryItem, LibraryQuery, LibrarySort, ReadingStatus } from '@shared/library'
import { READING_STATUSES } from '@shared/library'
import LibraryItemModal from '../components/LibraryItemModal'

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading', planned: 'Planned', completed: 'Completed',
  on_hold: 'On hold', dropped: 'Dropped'
}

const TABS: (ReadingStatus | 'all')[] = ['all', ...READING_STATUSES]

const SORTS: [LibrarySort, string][] = [
  ['last_read', 'Последнее чтение'], ['title', 'Название'], ['rating', 'Оценка'], ['added', 'Добавлено']
]

function coverSrc(url: string): string {
  return `manga://cover/${encodeURIComponent(url)}`
}

export default function Library(): JSX.Element {
  const { setScreen, setOpened, settings } = useStore()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [status, setStatus] = useState<ReadingStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<LibrarySort>('last_read')
  const [selected, setSelected] = useState<LibraryItem | null>(null)

  const refresh = useCallback(() => {
    const q: LibraryQuery = { status, search, sort, includeR34: settings.show_r34_history }
    void window.api.libraryList(q).then(setItems)
    void window.api.libraryCounts().then(setCounts)
  }, [status, search, sort, settings.show_r34_history])

  useEffect(refresh, [refresh])
  useEffect(() => window.api.onLibraryChanged(refresh), [refresh])

  const open = async (item: LibraryItem): Promise<void> => {
    const start = Math.max(0, item.currentPage - 1)
    const r = await window.api.openUrl(item.url, start, item.seriesId, item.coverUrl)
    if (r) {
      setOpened({ kind: 'online', ...r, startPage: start, coverUrl: item.coverUrl })
      setScreen('Reader')
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div className="screen library">
      <div className="library-toolbar">
        <input
          className="catalog-search"
          placeholder="Поиск по названию…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)}>
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="library-tabs">
        {TABS.map((t) => {
          const label = t === 'all' ? 'Все' : STATUS_LABELS[t]
          const n = t === 'all' ? total : (counts[t] ?? 0)
          return (
            <button
              key={t}
              className={`tab${status === t ? ' active' : ''}`}
              onClick={() => setStatus(t)}
            >{label} ({n})</button>
          )
        })}
      </div>

      {items.length === 0 && <div className="muted">В библиотеке пока пусто</div>}
      <div className="history-grid">
        {items.map((it) => (
          <div key={it.key} className="history-card" onClick={() => setSelected(it)}>
            <div className="history-cover">
              {it.coverUrl
                ? <img src={coverSrc(it.coverUrl)} alt="" loading="lazy" />
                : <div className="cover-placeholder" />}
            </div>
            <div className="history-title" title={it.title}>{it.title || 'Без названия'}</div>
            <div className="history-meta">
              <span>{it.status ? STATUS_LABELS[it.status] : ''}{it.rating != null ? ` · ★ ${it.rating}` : ''}</span>
              <button className="continue-btn" onClick={(e) => { e.stopPropagation(); void open(it) }}>▶ Открыть</button>
            </div>
            {it.note && <div className="library-note muted" title={it.note}>{it.note}</div>}
            <div className="bar-label muted">стр. {it.currentPage}/{it.totalPages}</div>
          </div>
        ))}
      </div>

      {selected && (
        <LibraryItemModal
          item={selected}
          onClose={() => setSelected(null)}
          onOpen={async () => { await open(selected); setSelected(null) }}
          onChanged={() => { setSelected(null); refresh() }}
        />
      )}
    </div>
  )
}
