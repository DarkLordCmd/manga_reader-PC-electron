import { useState } from 'react'
import { useStore } from '../state/store'
import type { MangaCard } from '@shared/mangadex'
import type { ChapterListItem } from '@shared/ipc'
import MangaCardGrid from '../components/MangaCardGrid'

const SORTS: { key: string; label: string }[] = [
  { key: 'relevance', label: 'По релевантности' },
  { key: 'rating', label: 'По рейтингу' },
  { key: 'latestUploadedChapter', label: 'Последние' },
  { key: 'followedCount', label: 'По подпискам' }
]

export default function Catalog(): JSX.Element {
  const { setScreen, setOpened } = useStore()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('relevance')
  const [page, setPage] = useState(0)
  const [cards, setCards] = useState<MangaCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<MangaCard | null>(null)
  const [chapters, setChapters] = useState<ChapterListItem[] | null>(null)
  const [chapterError, setChapterError] = useState<string | null>(null)

  const search = async (p: number): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.searchMangaDex(query.trim(), sort, p)
      setCards(res)
      setPage(p)
    } catch (e: any) {
      setCards([])
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const openChapters = async (card: MangaCard): Promise<void> => {
    setPicked(card)
    setChapters(null)
    setChapterError(null)
    try {
      setChapters(await window.api.fetchChapterList(card.manga_id))
    } catch (e: any) {
      setChapterError(String(e?.message ?? e))
    }
  }

  const openChapter = async (chapterId: string): Promise<void> => {
    if (!picked) return
    const r = await window.api.openUrl(chapterId, 0, picked.manga_id)
    if (r) {
      setOpened({ kind: 'online', ...r, startPage: 0 })
      setPicked(null)
      setScreen('Reader')
    }
  }

  return (
    <div className="catalog screen">
      <div className="catalog-toolbar">
        <input
          className="catalog-search"
          value={query}
          placeholder="Название манги…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void search(0) }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button disabled={loading} onClick={() => void search(0)}>Найти</button>
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && <div className="muted">Поиск…</div>}
      {!loading && cards.length > 0 && <MangaCardGrid cards={cards} onSelect={openChapters} />}

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