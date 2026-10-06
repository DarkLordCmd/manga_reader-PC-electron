import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { CatalogCard } from '@shared/ipc'
import type { ReadingStatus } from '@shared/library'
import MangaCardGrid from '../components/MangaCardGrid'
import ContextMenu, { type MenuItem } from '../components/ContextMenu'
import { buildLibraryMenuItems } from '../lib/library-menu'

type PopularSource = 'ehentai' | 'exhentai' | 'exhentai_onion'
const SOURCES: { key: PopularSource; label: string }[] = [
  { key: 'exhentai', label: 'ExHentai' },
  { key: 'ehentai', label: 'E-Hentai' },
  { key: 'exhentai_onion', label: 'ExHentai (onion)' }
]

export default function Popular(): JSX.Element {
  const { setScreen, setOpened, settings } = useStore()
  const [source, setSource] = useState<PopularSource>(settings.show_r34_history ? 'exhentai' : 'ehentai')
  const [cards, setCards] = useState<CatalogCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; card: CatalogCard; lookup: { key: string; favorited: boolean; status: ReadingStatus | null } | null } | null>(null)

  const reqRef = useRef(0)
  const load = useCallback(async () => {
    const id = ++reqRef.current
    setLoading(true); setError(null)
    try {
      const res = await window.api.catalogPopular(source)
      if (id !== reqRef.current) return
      setCards(res)
    } catch (e: any) {
      if (id !== reqRef.current) return
      setCards([]); setError(String(e?.message ?? e))
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [source])

  useEffect(() => { void load() }, [load])

  const open = async (c: CatalogCard): Promise<void> => {
    const r = await window.api.openUrl(c.url, 0, null, c.coverUrl, c.kind ?? null)
    if (r) { setOpened({ kind: 'online', ...r, startPage: 0, coverUrl: c.coverUrl }); setScreen('Reader') }
  }

  const openCardMenu = useCallback(async (e: React.MouseEvent, card: CatalogCard) => {
    e.preventDefault()
    const lookup = await window.api.libraryLookup(card.url, card.url)
    setMenu({ x: e.clientX, y: e.clientY, card, lookup })
  }, [])

  const menuItems = (m: NonNullable<typeof menu>): MenuItem[] =>
    buildLibraryMenuItems(
      {
        url: m.card.url, title: m.card.title, coverUrl: m.card.coverUrl,
        source: SOURCES.find((s) => s.key === source)?.label ?? '', seriesId: m.card.url, kind: m.card.kind ?? null
      },
      {
        key: m.lookup?.key ?? null,
        favorited: !!m.lookup?.favorited,
        status: m.lookup?.status ?? null
      }
    )

  return (
    <div className="screen catalog">
      <div className="catalog-toolbar">
        <select value={source} onChange={(e) => setSource(e.target.value as PopularSource)}>
          {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button disabled={loading} onClick={() => void load()}>Обновить</button>
      </div>
      <div className="catalog-body">
        <div className="catalog-content">
          {error && <div className="error-text">{error}</div>}
          {loading && cards.length === 0 && <div className="muted">Загрузка…</div>}
          {cards.length > 0 && <MangaCardGrid cards={cards} onSelect={(c) => void open(c)} onContextMenu={openCardMenu} />}
          {!loading && !error && cards.length === 0 && <div className="muted">Пусто</div>}
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
