import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { LibraryItem } from '@shared/library'
import ContextMenu, { type MenuItem } from '../components/ContextMenu'
import { READING_STATUSES, type ReadingStatus } from '@shared/library'

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Читаю', planned: 'В планах', completed: 'Прочитано', on_hold: 'Отложено', dropped: 'Брошено'
}
function coverSrc(url: string): string { return `manga://cover/${encodeURIComponent(url)}` }

export default function Favorites(): JSX.Element {
  const { setScreen, setOpened, settings } = useStore()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null)

  const refresh = useCallback(() => {
    void window.api.libraryList({ scope: 'favorites', search, sort: 'added', includeR34: settings.show_r34_history }).then(setItems)
  }, [search, settings.show_r34_history])
  useEffect(refresh, [refresh])
  useEffect(() => window.api.onLibraryChanged(refresh), [refresh])

  const open = async (item: LibraryItem): Promise<void> => {
    const start = Math.max(0, item.currentPage - 1)
    const r = await window.api.openUrl(item.url, start, item.seriesId, item.coverUrl)
    if (r) { setOpened({ kind: 'online', ...r, startPage: start, coverUrl: item.coverUrl }); setScreen('Reader') }
  }

  const itemsFor = (it: LibraryItem): MenuItem[] => {
    const out: MenuItem[] = [
      { label: 'Убрать из избранного', danger: true, onClick: () => void window.api.librarySetFavorite(it.key, null) },
      { label: '', separator: true, onClick: () => {} },
      { label: 'Статус', disabled: true, onClick: () => {} }
    ]
    for (const s of READING_STATUSES) {
      out.push({ label: STATUS_LABELS[s], checked: it.status === s, onClick: () => void window.api.librarySetStatusFor({ url: it.url, title: it.title, coverUrl: it.coverUrl, source: it.source, seriesId: it.seriesId }, s) })
    }
    if (it.status) {
      out.push({ label: '', separator: true, onClick: () => {} })
      out.push({ label: 'Убрать из библиотеки', danger: true, onClick: () => void window.api.libraryRemove(it.key) })
    }
    return out
  }

  return (
    <div className="screen library">
      <div className="library-toolbar">
        <input className="catalog-search" placeholder="Поиск по названию…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {items.length === 0 && <div className="muted">В избранном пока пусто (правый клик по карточке в каталоге)</div>}
      <div className="history-grid">
        {items.map((it) => (
          <div key={it.key} className="history-card"
            onClick={() => void open(it)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, item: it }) }}>
            <div className="history-cover">
              {it.coverUrl ? <img src={coverSrc(it.coverUrl)} alt="" loading="lazy" /> : <div className="cover-placeholder" />}
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
