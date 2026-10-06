import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { CatalogCard } from '@shared/ipc'
import MangaCardGrid from '../components/MangaCardGrid'

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

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setCards(await window.api.catalogPopular(source))
    } catch (e: any) {
      setCards([]); setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => { void load() }, [load])

  const open = async (c: CatalogCard): Promise<void> => {
    const r = await window.api.openUrl(c.url, 0, null, c.coverUrl)
    if (r) { setOpened({ kind: 'online', ...r, startPage: 0, coverUrl: c.coverUrl }); setScreen('Reader') }
  }

  return (
    <div className="screen catalog">
      <div className="catalog-toolbar">
        <select value={source} onChange={(e) => setSource(e.target.value as PopularSource)}>
          {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button disabled={loading} onClick={() => void load()}>Обновить</button>
      </div>
      {error && <div className="error-text">{error}</div>}
      {loading && cards.length === 0 && <div className="muted">Загрузка…</div>}
      {cards.length > 0 && <MangaCardGrid cards={cards} onSelect={(c) => void open(c)} />}
      {!loading && !error && cards.length === 0 && <div className="muted">Пусто</div>}
    </div>
  )
}
