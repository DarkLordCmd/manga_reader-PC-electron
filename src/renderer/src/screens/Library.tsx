import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import type { LibraryItem, LibrarySort, ReadingStatus } from '@shared/library'
import { READING_STATUSES } from '@shared/library'
import LibraryItemModal from '../components/LibraryItemModal'
import CoverImg from '../components/CoverImg'
import KindBadge from '../components/KindBadge'
import ContextMenu, { type MenuItem } from '../components/ContextMenu'
import { buildLibraryMenuItems, STATUS_LABELS } from '../lib/library-menu'

const TABS: (ReadingStatus | 'all')[] = ['all', ...READING_STATUSES]

const SORTS: [LibrarySort, string][] = [
  ['last_read', 'Последнее чтение'], ['title', 'Название'], ['rating', 'Оценка'], ['added', 'Добавлено']
]

export default function Library(): JSX.Element {
  const { setScreen, setOpened, settings } = useStore()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [allItems, setAllItems] = useState<LibraryItem[]>([])
  const [status, setStatus] = useState<ReadingStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<LibrarySort>('last_read')
  const [selected, setSelected] = useState<LibraryItem | null>(null)
  const [category, setCategory] = useState<'main' | 'r34'>('main')
  const [menu, setMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null)
  const cat = settings.show_r34_history ? category : 'main'

  const refresh = useCallback(() => {
    const effCat = settings.show_r34_history ? category : 'main'
    void window.api.libraryList({ status, search, sort, category: effCat }).then(setItems)
    void window.api.libraryList({ status: 'all', category: effCat }).then(setAllItems)
  }, [status, search, sort, category, settings.show_r34_history])

  useEffect(refresh, [refresh])
  useEffect(() => window.api.onLibraryChanged(refresh), [refresh])

  const open = async (item: LibraryItem): Promise<void> => {
    const start = Math.max(0, item.currentPage - 1)
    const r = await window.api.openUrl(item.url, start, item.seriesId, item.coverUrl, item.kind ?? null)
    if (r) {
      setOpened({ kind: 'online', ...r, startPage: start, coverUrl: item.coverUrl })
      setScreen('Reader')
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const it of allItems) if (it.status) c[it.status] = (c[it.status] ?? 0) + 1
    return c
  }, [allItems])
  const total = allItems.length

  return (
    <div className="screen library">
      <div className="library-toolbar">
        <button className={cat === 'main' ? 'tab active' : 'tab'} onClick={() => setCategory('main')}>📖 Main</button>
        {settings.show_r34_history && (
          <button className={cat === 'r34' ? 'tab active' : 'tab'} onClick={() => setCategory('r34')}>🔞 R34</button>
        )}
        <div className="spacer" />
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
          <div key={it.key} className="history-card"
            onClick={() => setSelected(it)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, item: it }) }}>
            <div className="history-cover">
              <CoverImg url={it.coverUrl} />
              <KindBadge kind={it.kind} />
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

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={buildLibraryMenuItems(
            { url: menu.item.url, title: menu.item.title, coverUrl: menu.item.coverUrl, source: menu.item.source, seriesId: menu.item.seriesId, kind: menu.item.kind },
            { key: menu.item.key, favorited: menu.item.favoritedAt !== null, status: menu.item.status }
          )}
        />
      )}
    </div>
  )
}
