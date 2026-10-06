import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { startPageFor } from '@shared/settings'
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
  const webtoon = opened?.kind === 'online' && !!opened.webtoon
  const [hideToolbar, setHideToolbar] = useState(false)

  useEffect(() => {
    const sp = opened?.startPage ?? 0
    setCurrentIndex(sp)
    // Jump the ScrollView to the restored position — otherwise it sits on
    // the top of the document, the observer fires for page 1 and the saved
    // progress is silently reset to the first page.
    setJumpTo(sp > 0 ? sp : null)
  }, [opened])

  useEffect(() => {
    if (!showHelp) return
    const fn = (e: KeyboardEvent): void => { if (e.key === 'Escape') setShowHelp(false) }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [showHelp])

  // Progress is flushed like JHenTai does: a periodic timer + a final write
  // when the reader (or gallery) closes — not an IPC on every scroll tick.
  const idxRef = useRef(0)
  const savedRef = useRef({ url: '', page: -1 })
  idxRef.current = currentIndex
  const flushProgress = useCallback((immediate: boolean): void => {
    const o = opened
    if (!o || pageCount === 0) return
    const page = idxRef.current + 1
    if (!immediate && page === savedRef.current.page && o.url === savedRef.current.url) return
    savedRef.current = { url: o.url, page }
    // Also informs the main process so warm-ahead (load pages ~32 forward)
    // re-centers around the current position.
    if (o.kind === 'online') window.api.setReadingPosition(o.id, idxRef.current)
    window.api.recordProgress(o.url, page, pageCount)
  }, [opened, pageCount])

  useEffect(() => {
    if (!opened || pageCount === 0) return
    const flushMs = setTimeout(() => flushProgress(false), 1200)
    const intervalMs = setInterval(() => flushProgress(false), 5000)
    return () => {
      clearTimeout(flushMs)
      clearInterval(intervalMs)
      flushProgress(true)
    }
    // flush one final time when the gallery or the reader unmounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened?.url, pageCount, currentIndex])

  const goNext = useCallback(() => {
    const next = Math.min(currentIndex + perScreen, Math.max(0, pageCount - 1))
    setCurrentIndex(next)
    if (settings.reading_mode === 'Scroll') setJumpTo(next)
  }, [currentIndex, perScreen, pageCount, settings.reading_mode])
  const goPrev = useCallback(() => {
    const next = Math.max(0, currentIndex - perScreen)
    setCurrentIndex(next)
    if (settings.reading_mode === 'Scroll') setJumpTo(next)
  }, [currentIndex, perScreen, settings.reading_mode])

  useHotkeys({
    onPrev: goPrev,
    onNext: goNext,
    onToggleThumbs: () => setSettings({ ...settings, show_thumbnails: !settings.show_thumbnails }),
    onToggleMode: () => setSettings({ ...settings, reading_mode: settings.reading_mode === 'Scroll' ? 'Book' : 'Scroll' }),
    onToggleHelp: () => setShowHelp((v) => !v),
    onToggleImmersive: () => {
      setHideToolbar((v) => {
        const next = !v
        if (next) void document.documentElement.requestFullscreen().catch(() => {})
        else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
        return next
      })
    }
  }, rtl)

  const onVisible = useCallback((i: number) => {
    if (Number.isInteger(i)) setCurrentIndex(i)
  }, [])
  const onJumpDone = useCallback(() => setJumpTo(null), [])

  // Mark chapter as fully read when reaching the last page.
  useEffect(() => {
    if (!opened || opened.kind !== 'online' || pageCount === 0) return
    if (!Number.isInteger(currentIndex) || currentIndex + 1 >= pageCount) {
      if (!Number.isInteger(currentIndex)) return
      window.api.markChapterRead(opened.url)
    }
  }, [opened, currentIndex, pageCount])

  // Auto-advance to the next chapter after ~1s at the end (Scroll mode).
  // Guards: only fire when the user really is on the LAST page — a NaN or
  // stale currentIndex (transient observer report / gallery change) must
  // never legitimately open the next chapter on its own.
  const advancedRef = useRef(false)
  useEffect(() => {
    if (!opened || opened.kind !== 'online' || settings.reading_mode !== 'Scroll') return
    const list = opened.chapterList
    const idx = opened.chapterIndex
    if (!list || idx == null) return
    if (!Number.isInteger(currentIndex) || !Number.isInteger(pageCount) || pageCount === 0) return
    if (currentIndex !== pageCount - 1) {
      advancedRef.current = false
      return
    }
    if (advancedRef.current) return
    const next = list[idx + 1]
    if (!next) return
    advancedRef.current = true
    const mangaId = opened.mangaId
    const coverUrl = opened.coverUrl
    const t = setTimeout(() => {
      void (async () => {
        const r = await window.api.openUrl(next.chapter_id, 0, mangaId, coverUrl)
        if (r) {
          setOpened({
            kind: 'online', ...r, startPage: 0, coverUrl,
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
      const saved = startPageFor(url, settings.read_progress)
      const r = await window.api.openUrl(url, saved)
      if (r) {
        setOpened({ kind: 'online', ...r, startPage: saved })
        setUrlText('')
      } else {
        alert('Не удалось открыть URL')
      }
    } finally {
      setOpeningUrl(false)
    }
  }, [urlText, settings.read_progress, setOpened])

  const openChapter = useCallback(async (chapterId: string, chapterList: import('@shared/ipc').ChapterListItem[], chapterIndex: number) => {
    const current = opened?.kind === 'online' ? opened : null
    const saved = startPageFor(chapterId, settings.read_progress)
    const r = await window.api.openUrl(chapterId, saved, current?.mangaId ?? null, current?.coverUrl ?? null)
    if (r) {
      setOpened({ kind: 'online', ...r, startPage: saved, coverUrl: current?.coverUrl ?? null, chapterList, chapterIndex })
      setShowChapters(false)
    }
  }, [opened, settings.read_progress, setOpened])

  const buyArchive = useCallback(async () => {
    if (opened?.kind !== 'online') return
    const cost = await window.api.ehArchiveCost(opened.url)
    if (!cost) { alert('Не удалось получить страницу архива'); return }
    const costText = cost.costGp != null ? `Стоимость: ${cost.costGp} GP.` : 'Стоимость неизвестна.'
    let dltype = cost.options[0]?.key ?? 'org'
    if (cost.options.length > 1) {
      const labels = cost.options.map((o) => `'${o.key}' (${o.label})`).join(' / ')
      const input = window.prompt(`${costText} Выберите формат архива: ${labels}`, dltype)
      const chosen = input != null && input.trim() !== '' ? cost.options.find((o) => o.key === input.trim()) : undefined
      if (chosen) dltype = chosen.key
    }
    if (!window.confirm(`${costText} Купить и скачать оригинальный архив?`)) return
    const r = await window.api.ehArchiveBuy(opened.url, dltype)
    if (!r?.downloadUrl) { alert('Не удалось купить архив (нет ссылки на скачивание)'); return }
    const task = await window.api.downloadsAddArchive(opened.url, opened.title, r.downloadUrl)
    if (!task) { alert('Такая галерея уже есть в загрузках'); return }
    alert('Архив скачивается в Downloads')
  }, [opened])

  return (
    <div className={`reader${hideToolbar ? ' immersive' : ''}`}>
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
        {opened?.kind === 'online' && (
          <button onClick={() => void (async () => {
            await window.api.libraryAdd({
              url: opened.url,
              title: opened.title,
              coverUrl: opened.coverUrl ?? null,
              source: opened.source,
              seriesId: opened.mangaId ?? opened.url
            })
          })()}>＋ Library</button>
        )}
        {opened && (
          <button onClick={() => void window.api.recordProgress(opened.url, 0, 1)}>Сбросить</button>
        )}
        {opened?.kind === 'online' && (opened.source.includes('ExHentai') || opened.source.includes('E-Hentai')) && (
          <button onClick={() => void buyArchive()}>⬇ Archive</button>
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
            webtoon={webtoon}
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
        {pageCount > 1 && (
          <input
            className="reader-slider"
            type="range"
            min={1}
            max={pageCount}
            value={Math.min(currentIndex + 1, pageCount)}
            onChange={(e) => { const v = Number(e.target.value) - 1; setCurrentIndex(v); setJumpTo(v) }}
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