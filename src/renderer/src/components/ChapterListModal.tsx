import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { ChapterListItem } from '@shared/ipc'

interface Props {
  mangaId: string
  onOpenChapter: (chapterId: string) => void
  onClose: () => void
}

export default function ChapterListModal({ mangaId, onOpenChapter, onClose }: Props): JSX.Element {
  const { opened } = useStore()
  const [chapters, setChapters] = useState<ChapterListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.fetchChapterList(mangaId)
      .then((c) => { if (!cancelled) setChapters(c) })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)) })
    return () => { cancelled = true }
  }, [mangaId])

  const currentUrl = opened?.kind === 'online' ? opened.url : ''

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card chapters" onClick={(e) => e.stopPropagation()}>
        <h3>Главы</h3>
        <div className="chapter-list">
          {error && <div className="error-text">{error}</div>}
          {!chapters && !error && <div>Загрузка…</div>}
          {chapters && chapters.map((c) => {
            const isCurrent = c.chapter_id === currentUrl
            const label = c.title ? `${c.chapter_num} — ${c.title}` : c.chapter_num
            return (
              <button
                key={c.chapter_id}
                className={`chapter-item${isCurrent ? ' current' : ''}`}
                onClick={() => onOpenChapter(c.chapter_id)}
              >
                {label}
              </button>
            )
          })}
        </div>
        <button onClick={onClose}>Закрыть</button>
      </div>
    </div>
  )
}