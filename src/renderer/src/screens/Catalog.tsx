import { useState } from 'react'
import { useStore } from '../state/store'
import type { CatalogCard, ChapterListItem } from '@shared/ipc'
import MangaCardGrid from '../components/MangaCardGrid'

const SOURCES: { key: string; label: string }[] = [
  { key: 'mangadex', label: 'MangaDex' },
  { key: 'exhentai', label: 'ExHentai' },
  { key: 'exhentai_onion', label: 'ExHentai (onion)' },
  { key: 'ehentai', label: 'E-Hentai' },
  { key: 'nhentai', label: 'NHentai' },
  { key: 'nhentai_onion', label: 'NHentai (onion)' },
  { key: 'comx', label: 'Com-X' },
  { key: 'senkuro', label: 'Senkuro' },
  { key: 'mangashi', label: 'Manga-shi' },
  { key: 'remanga', label: 'Remanga' },
  { key: 'mangalib', label: 'Mangalib' }
]

const SORTS: { key: string; label: string }[] = [
  { key: 'relevance', label: 'По релевантности' },
  { key: 'rating', label: 'По рейтингу' },
  { key: 'latestUploadedChapter', label: 'Последние' },
  { key: 'followedCount', label: 'По подпискам' }
]

export default function Catalog(): JSX.Element {
  const { setScreen, setOpened } = useStore()
  const [source, setSource] = useState('mangadex')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('relevance')
  const [page, setPage] = useState(0)
  const [cards, setCards] = useState<CatalogCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<CatalogCard | null>(null)
  const [chapters, setChapters] = useState<ChapterListItem[] | null>(null)
  const [chapterError, setChapterError] = useState<string | null>(null)

  const search = async (p: number): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.searchCatalog(source, query.trim(), p, sort)
      setCards(res)
      setPage(p)
    } catch (e: any) {
      setCards([])
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const openChapters = async (card: CatalogCard): Promise<void> => {
    // For MangaDex the card url is a bare manga id; for others it's a series URL
    if (source !== 'mangadex') {
      // Non-MangaDex cards represent a series page: open its chapter list
      setPicked(card)
      setChapters(null)
      setChapterError(null)
      try {
        setChapters(await window.api.fetchChapterList(card.url))
      } catch (e: any) {
        setChapterError(String(e?.message ?? e))
      }
      return
    }
    setPicked(card)
    setChapters(null)
    setChapterError(null)
    try {
      setChapters(await window.api.fetchChapterList(card.url))
    } catch (e: any) {
      setChapterError(String(e?.message ?? e))
    }
  }

  const openChapter = async (chapterId: string): Promise<void> => {
    const mangaId = picked && source === 'mangadex' ? picked.url : null
    const r = await window.api.openUrl(chapterId, 0, mangaId)
    if (r) {
      setOpened({ kind: 'online', ...r, startPage: 0 })
      setPicked(null)
      setScreen('Reader')
    }
  }

  return (
    <div className="catalog screen">
      <div className="catalog-toolbar">
        <select value={source} onChange={(e) => { setSource(e.target.value); setCards([]); setError(null) }}>
          {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <input
          className="catalog-search"
          value={query}
          placeholder="Название манги…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void search(0) }}
        />
        {source === 'mangadex' && (
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        )}
        <button disabled={loading} onClick={() => void search(0)}>Найти</button>
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && <div className="muted">Поиск…</div>}
      {!loading && cards.length > 0 && (
        <MangaCardGrid cards={cards} onSelect={(c) => void openChapters(c)} />
      )}

      {cards.length > 0 && (
        <div className="catalog-pager">
          <button disabled={page === 0 || loading} onClick={() => void search(page - 1)}>Пред.</button>
          <span className="muted">Стр. {page + 1}</span>
          <button disabled={loading} onClick={() => void search(page + 1)}>След.</button>
        </div>
      )}

      {picked && (
        <div className="overlay" onClick={() => setPicked(null)}>
          <div className="overlay-card chapters" onClick={(e) => e.stopPropagation()}>
            <h3>{picked.title}</h3>
            <div className="chapter-list">
              {chapterError && <div className="error-text">{chapterError}</div>}
              {!chapters && !chapterError && <div>Загрузка…</div>}
              {chapters && chapters.map((c) => (
                <button key={c.chapter_id} className="chapter-item" onClick={() => void openChapter(c.chapter_id)}>
                  {c.title ? `${c.chapter_num} — ${c.title}` : c.chapter_num}
                </button>
              ))}
            </div>
            <button onClick={() => setPicked(null)}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  )
}