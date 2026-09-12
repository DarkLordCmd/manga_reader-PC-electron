import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { useHotkeys } from '../hooks/useHotkeys'
import ScrollView from '../components/ScrollView'
import BookView from '../components/BookView'
import ThumbnailPanel from '../components/ThumbnailPanel'
import ChapterListModal from '../components/ChapterListModal'

export default function Reader(): JSX.Element {
  const { settings, setSettings, opened, setOpened } = useStore()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [jumpTo, setJumpTo] = useState<number | null>(null)
  const [jumpText, setJumpText] = useState('')
  const [urlText, setUrlText] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [showChapters, setShowChapters] = useState(false)
  const [openingUrl, setOpeningUrl] = useState(false)

  const perScreen = Math.max(1, settings.pages_per_screen)
  const pageCount = opened?.pageCount ?? 0
  const rtl = settings.reading_mode === 'Book' && settings.book_direction === 'Rtl'

  useEffect(() => {
    setCurrentIndex(opened?.startPage ?? 0)
    setJumpTo(null)
  }, [opened])

  useEffect(() => {
    if (!showHelp) return
    const fn = (e: KeyboardEvent): void => { if (e.key === 'Escape') setShowHelp(false) }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [showHelp])

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + perScreen, Math.max(0, pageCount - 1)))
  }, [perScreen, pageCount])
  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - perScreen))
  }, [perScreen])

  useHotkeys({
    onPrev: goPrev,
    onNext: goNext,
    onToggleThumbs: () => setSettings({ ...settings, show_thumbnails: !settings.show_thumbnails }),
    onToggleMode: () => setSettings({ ...settings, reading_mode: settings.reading_mode === 'Scroll' ? 'Book' : 'Scroll' }),
    onToggleHelp: () => setShowHelp((v) => !v)
  }, rtl)

  const onVisible = useCallback((i: number) => setCurrentIndex(i), [])
  const onJumpDone = useCallback(() => setJumpTo(null), [])

  useEffect(() => {
    if (!opened || pageCount === 0) return
    if (opened.kind === 'online') window.api.setReadingPosition(opened.id, currentIndex)
    window.api.recordProgress(opened.url, currentIndex + 1, pageCount)
  }, [opened, currentIndex, pageCount])

  // Mark chapter as fully read when reaching the last page.
  useEffect(() => {
    if (!opened || opened.kind !== 'online' || pageCount === 0) return
    if (currentIndex + 1 >= pageCount) {
      window.api.markChapterRead(opened.url)
    }
  }, [opened, currentIndex, pageCount])

  // Auto-advance to the next chapter after ~1s at the end (Scroll mode).
  const advancedRef = useRef(false)
  useEffect(() => {
    if (!opened || opened.kind !== 'online' || settings.reading_mode !== 'Scroll') return
    const list = opened.chapterList
    const idx = opened.chapterIndex
    if (!list || idx == null) return
    if (currentIndex + 1 < pageCount) {
      advancedRef.current = false
      return
    }
    if (advancedRef.current) return
    const next = list[idx + 1]
    if (!next) return
    advancedRef.current = true
    const mangaId = opened.mangaId
    const t = setTimeout(() => {
      void (async () => {
        const r = await window.api.openUrl(next.chapter_id, 0, mangaId)
        if (r) {
          setOpened({
            kind: 'online', ...r, startPage: 0,
            chapterList: list, chapterIndex: idx + 1
          })
        }
        advancedRef.current = false
      })()
    }, 1000)
    return () => clearTimeout(t)
  }, [opened, currentIndex, pageCount, settings.reading_mode, setOpened])

  const jump = useMemo(() => (): void => {
    const n = parseInt(jumpText, 10)
    if (!isNaN(n)) setJumpTo(Math.min(Math.max(0, n - 1), Math.max(0, pageCount - 1)))
  }, [jumpText, pageCount])

  const openFolder = useCallback(async () => {
    const g = await window.api.pickFolder()
    if (g) setOpened({ kind: 'local', ...g, startPage: 0 })
  }, [setOpened])

  const refreshFolder = useCallback(async () => {
    if (!opened || opened.kind !== 'local') return
    const g = await window.api.rescanFolder(opened.url.slice('file://'.length))
    if (g) {
      setOpened({ kind: 'local', ...g, startPage: 0 })
      setJumpTo(0)
    }
  }, [opened, setOpened])

  const openUrl = useCallback(async () => {
    const url = urlText.trim()
    if (!url) return
    setOpeningUrl(true)
    try {
      const r = await window.api.openUrl(url)
      if (r) {
        setOpened({ kind: 'online', ...r, startPage: 0 })
        setUrlText('')
      } else {
        alert('Не удалось открыть URL')
      }
    } finally {
      setOpeningUrl(false)
    }
  }, [urlText, setOpened])

  const openChapter = useCallback(async (chapterId: string, chapterList: import('@shared/ipc').ChapterListItem[], chapterIndex: number) => {
    const r = await window.api.openUrl(chapterId, 0, opened?.kind === 'online' ? opened.mangaId : null)
    if (r) {
      setOpened({ kind: 'online', ...r, startPage: 0, chapterList, chapterIndex })
      setShowChapters(false)
    }
  }, [opened, setOpened])

  return (
    <div className="reader">
      <div className="reader-toolbar">
        <button onClick={openFolder}>Open</button>
        {opened?.kind === 'local' && <button onClick={() => void refreshFolder()}>Refresh</button>}
        <span className="reader-title">{opened?.title ?? 'Нет галереи'}</span>
        <select
          value={settings.reading_mode}
          onChange={(e) => setSettings({ ...settings, reading_mode: e.target.value as 'Scroll' | 'Book' })}
        >
          <option value="Scroll">Scroll</option>
          <option value="Book">Book</option>
        </select>
        {opened?.kind === 'online' && (
          <button onClick={() => setShowChapters(true)}>Главы</button>
        )}
        <div className="spacer" />
        <input
          className="url-input"
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
          placeholder="MangaDex / ExHentai URL или UUID"
          onKeyDown={(e) => { if (e.key === 'Enter') void openUrl() }}
          style={{ width: 210 }}
        />
        <button disabled={openingUrl} onClick={() => void openUrl()}>URL</button>
        <span className="muted">Pg {pageCount === 0 ? 0 : currentIndex + 1}/{pageCount}</span>
        <input value={jumpText} onChange={(e) => setJumpText(e.target.value)} placeholder="#" style={{ width: 44 }} />
        <button onClick={jump}>Go</button>
      </div>

      {!opened && <div className="screen">Открой папку кнопкой Open или вставь URL</div>}

      {opened && (
        <div className="reader-body">
          {settings.show_thumbnails && (
            <ThumbnailPanel
              galleryId={opened.id}
              pageCount={pageCount}
              currentIndex={currentIndex}
              thumbSize={settings.thumb_size}
              onSelect={(i) => { setCurrentIndex(i); setJumpTo(i) }}
            />
          )}
          <div className="reader-content">
            {settings.reading_mode === 'Scroll' && (
              <ScrollView
                galleryId={opened.id}
                pageCount={pageCount}
                widthScale={settings.width_scale}
                currentIndex={currentIndex}
                jumpTo={jumpTo}
                onVisible={onVisible}
                onJumpDone={onJumpDone}
              />
            )}
            {settings.reading_mode === 'Book' && (
              <BookView
                galleryId={opened.id}
                pageCount={pageCount}
                currentIndex={currentIndex}
                pagesPerScreen={perScreen}
                direction={settings.book_direction}
                onPrev={goPrev}
                onNext={goNext}
              />
            )}
          </div>
        </div>
      )}

      {showChapters && opened?.kind === 'online' && opened.mangaId && (
        <ChapterListModal
          mangaId={opened.mangaId}
          currentUrl={opened.url}
          onClose={() => setShowChapters(false)}
          onOpenChapter={async (chapterId, chapterList, chapterIndex) => {
            await openChapter(chapterId, chapterList, chapterIndex)
          }}
        />
      )}

      {showHelp && (
        <div className="overlay" onClick={() => setShowHelp(false)}>
          <div className="overlay-card">
            <h3>Keyboard Shortcuts</h3>
            <ul>
              <li>← / A — Previous page{rtl ? ' (RTL: next)' : ''}</li>
              <li>→ / D — Next page{rtl ? ' (RTL: prev)' : ''}</li>
              <li>↑ / W — Previous screen</li>
              <li>↓ / S — Next screen</li>
              <li>T — Toggle thumbnails</li>
              <li>M — Toggle reading mode</li>
              <li>? — Toggle this help</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}