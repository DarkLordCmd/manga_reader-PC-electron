import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { LibraryItem } from '@shared/library'
import ContextMenu, { type MenuItem } from '../components/ContextMenu'
import CoverImg from '../components/CoverImg'
import KindBadge from '../components/KindBadge'
import { buildLibraryMenuItems, STATUS_LABELS } from '../lib/library-menu'

export default function Favorites(): JSX.Element {
  const { setScreen, setOpened, settings } = useStore()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'main' | 'r34'>('main')
  const [menu, setMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null)
  const cat = settings.show_r34_history ? category : 'main'

  const refresh = useCallback(() => {
    const effCat = settings.show_r34_history ? category : 'main'
    void window.api.libraryList({ scope: 'favorites', search, sort: 'added', category: effCat }).then(setItems)
  }, [search, category, settings.show_r34_history])
  useEffect(refresh, [refresh])
  useEffect(() => window.api.onLibraryChanged(refresh), [refresh])

  const open = async (item: LibraryItem): Promise<void> => {
    const start = Math.max(0, item.currentPage - 1)
    const r = await window.api.openUrl(item.url, start, item.seriesId, item.coverUrl, item.kind ?? null)
    if (r) { setOpened({ kind: 'online', ...r, startPage: start, coverUrl: item.coverUrl }); setScreen('Reader') }
  }

  const itemsFor = (it: LibraryItem): MenuItem[] =>
    buildLibraryMenuItems(
      { url: it.url, title: it.title, coverUrl: it.coverUrl, source: it.source, seriesId: it.seriesId, kind: it.kind },
      { key: it.key, favorited: it.favoritedAt !== null, status: it.status }
    )

  return (
    <div className="screen library">
      <div className="library-toolbar">
        <button className={cat === 'main' ? 'tab active' : 'tab'} onClick={() => setCategory('main')}>📖 Main</button>
        {settings.show_r34_history && (
          <button className={cat === 'r34' ? 'tab active' : 'tab'} onClick={() => setCategory('r34')}>🔞 R34</button>
        )}
        <div className="spacer" />
        <input className="catalog-search" placeholder="Поиск по названию…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {items.length === 0 && <div className="muted">В избранном пока пусто (правый клик по карточке в каталоге)</div>}
      <div className="history-grid">
        {items.map((it) => (
          <div key={it.key} className="history-card"
            onClick={() => void open(it)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, item: it }) }}>
            <div className="history-cover">
              {it.coverUrl ? <CoverImg url={it.coverUrl} /> : <div className="cover-placeholder" />}
              <KindBadge kind={it.kind} />
            </div>
            <div className="history-title" title={it.title}>{it.title || 'Без названия'}</div>
            <div className="history-meta">
              <span>{it.status ? STATUS_LABELS[it.status] : 'Избранное'}</span>
              <button className="continue-btn" onClick={(e) => { e.stopPropagation(); void open(it) }}>▶ Открыть</button>
            </div>
            <div className="bar-label muted">стр. {it.currentPage}/{it.totalPages}</div>
          </div>
        ))}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={itemsFor(menu.item)} onClose={() => setMenu(null)} />}
    </div>
  )
}
