import { errorText } from '../lib/errors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startPageFor, startScrollFor } from '@shared/settings';
import type { ArchiveCost } from '@shared/ipc';
import { useStore } from '../state/store';
import { useHotkeys } from '../hooks/useHotkeys';
import ScrollView from '../components/ScrollView';
import BookView from '../components/BookView';
import ThumbnailPanel from '../components/ThumbnailPanel';
import ChapterListModal from '../components/ChapterListModal';
import EhInfoModal from './reader/EhInfoModal';
import { useBodyScrollLock, useDialogFocus } from '../lib/use-modal';
import { isReaderAtEnd, clampWidthScale, WIDTH_SCALE_DEFAULT, spreadStart } from './reader/viewMath';

/** Last reading position per open gallery. Leaving the Reader screen unmounts
 * the component while `opened` stays in the store: without this, coming back
 * from History/Catalog restored the stale `opened.startPage` (the page the
 * gallery was opened at) and the next progress flush persisted that rollback. */
let lastPosition = { key: '', index: 0 };

export default function Reader(): JSX.Element {
  const { settings, setSettings, opened, setOpened } = useStore();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [jumpTo, setJumpTo] = useState<{ index: number; offset: number } | null>(null);
  const [jumpText, setJumpText] = useState('');
  const [urlText, setUrlText] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [openingUrl, setOpeningUrl] = useState(false);
  const [archive, setArchive] = useState<ArchiveCost | null>(null);
  const [archiveDltype, setArchiveDltype] = useState('org');
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [showEhInfo, setShowEhInfo] = useState(false);
  const helpDialogRef = useDialogFocus(() => setShowHelp(false), undefined, showHelp);
  const archiveDialogRef = useDialogFocus(() => {
    if (!archiveBusy) setArchive(null);
  }, undefined, !!archive);
  useBodyScrollLock(showHelp);
  useBodyScrollLock(!!archive);

  // The main process orders page loading by distance from the reading position;
  // it only learned that position from the 1.2-5 s progress flush, so a fast
  // scroll/jump loaded pages around a stale target. Sync it on every navigation.
  const openedRef = useRef(opened);
  openedRef.current = opened;
  const posSyncPendingRef = useRef(0);
  const posSyncTimerRef = useRef<number | null>(null);
  const syncReadingPosition = useCallback((index: number) => {
    const o = openedRef.current;
    if (o?.kind !== 'online') return;
    // Called on every visible-page change: while scrolling fast that is several
    // IPC calls per second. Coalesce to one per 400 ms (trailing) — the main
    // process only uses it to re-center the warm-ahead window.
    posSyncPendingRef.current = index;
    if (posSyncTimerRef.current != null) return;
    const send = (): void => {
      posSyncTimerRef.current = null;
      const o2 = openedRef.current;
      if (o2?.kind === 'online') void window.api.setReadingPosition(o2.id, posSyncPendingRef.current);
    };
    posSyncTimerRef.current = window.setTimeout(send, 400);
  }, []);

  const perScreen = Math.max(1, settings.pages_per_screen);
  const pageCount = opened?.pageCount ?? 0;
  const rtl = settings.reading_mode === 'Book' && settings.book_direction === 'Rtl';
  const webtoon = opened?.kind === 'online' && !!opened.webtoon;
  const [hideToolbar, setHideToolbar] = useState(false);

  const openedKeyRef = useRef('');
  /** Auto-advance is only armed by real navigation (scroll/next): landing on
   * the last page via the slider, a thumbnail or a restore must not open the
   * next chapter one second later. */
  const advanceArmedRef = useRef(false);
  useEffect(() => {
    const id = opened?.id ?? '';
    if (!opened) return;
    if (openedKeyRef.current === id) {
      // Same gallery re-rendered (e.g. History attached the chapter list a few
      // seconds after "Продолжить"): keep the user's position and offset.
      setCurrentIndex((prev) => Math.min(Math.max(0, prev), Math.max(0, pageCount - 1)));
      return;
    }
    openedKeyRef.current = id;
    advanceArmedRef.current = false;
    // New gallery: forget the previous chapter's in-page offset until the user
    // actually scrolls (offsetDirty gate in flushProgress protects the stored
    // value from being overwritten by race/restore flushes).
    offRef.current = 0;
    offsetDirtyRef.current = false;
    const last = Math.max(0, pageCount - 1);
    // A remount of the SAME gallery keeps the last position; a fresh gallery
    // uses the one the caller computed (history row / openUrl).
    const sp = lastPosition.key === id ? lastPosition.index : (opened.startPage ?? 0);
    // Clamp the restored position: a gallery that shrank (rescan, shorter
    // chapter) must never show Pg outside 1..pageCount.
    const idx = Math.min(Math.max(0, Number.isFinite(sp) ? sp : 0), last);
    setCurrentIndex(idx);
    // Jump the ScrollView to the restored position — otherwise it sits on
    // the top of the document, the observer fires for page 1 and the saved
    // progress is silently reset to the first page. Webtoons additionally
    // restore the vertical offset saved inside the page (fetched fresh, so a
    // re-open within the same session sees the latest position too).
    const key = opened.url ?? '';
    void window.api.getSettings().then((fresh) => {
      if (openedKeyRef.current !== id) return;
      const off = startScrollFor(key, fresh.read_scroll);
      setJumpTo(idx > 0 || off > 0 ? { index: idx, offset: off } : null);
    });
  }, [opened, pageCount]);

  // Remember the position for a same-session remount of the Reader screen.
  useEffect(() => {
    const id = opened?.id;
    if (id) lastPosition = { key: id, index: currentIndex };
  }, [opened?.id, currentIndex]);

  const onUserScroll = useCallback(() => {
    // Real (non-programmatic) scrolling arms the end-of-chapter auto-advance;
    // slider/thumbnail/restore jumps do not.
    advanceArmedRef.current = true;
  }, []);

  // Leaving the reader with immersive mode on used to keep the WHOLE window in
  // DOM fullscreen (the catalog was then rendered as a fullscreen document).
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    },
    [],
  );

  // Progress is flushed like JHenTai does: a periodic timer + a final write
  // when the reader (or gallery) closes — not an IPC on every scroll tick.
  const idxRef = useRef(0);
  const savedRef = useRef<{ url: string; page: number; off: number | undefined }>({ url: '', page: -1, off: undefined });
  idxRef.current = currentIndex;
  const offRef = useRef(0);
  const offsetDirtyRef = useRef(false);
  /** Set by the "Сбросить" button: the periodic/final flush must not write the
   * current page back and undo the reset. Cleared as soon as the user actually
   * moves (page change) — from then on progress is recorded normally. */
  const suppressFlushRef = useRef(false);
  const onVisiblePos = useCallback((index: number, offsetPx: number): void => {
    // Atomic pair: page index and in-page offset come from the SAME scroll
    // observation, so a flush can never mix a page from one moment with an
    // offset from another (the "not always the right spot" flakiness).
    offRef.current = Math.round(offsetPx);
    offsetDirtyRef.current = true;
    setCurrentIndex((prev) => (prev === index ? prev : index)); // bails out when unchanged
  }, []);
  const flushProgress = useCallback(
    (immediate: boolean): void => {
      const o = opened;
      if (!o || pageCount === 0) return;
      // A manual reset must survive the final flush when the reader closes.
      if (suppressFlushRef.current) return;
      const page = idxRef.current + 1;
      const off = offsetDirtyRef.current ? offRef.current : undefined;
      if (!immediate && page === savedRef.current.page && o.url === savedRef.current.url && off === savedRef.current.off) return;
      savedRef.current = { url: o.url, page, off };
      // Also informs the main process so warm-ahead (load pages ~32 forward)
      // re-centers around the current position.
      if (o.kind === 'online') window.api.setReadingPosition(o.id, idxRef.current);
      // Send `off` (undefined while no scroll was observed since the gallery
      // opened) rather than offRef.current: an unconditional 0 wiped the saved
      // in-page offset of a webtoon the user simply had not scrolled yet.
      window.api.recordProgress(o.url, page, pageCount, off);
    },
    [opened, pageCount],
  );

  useEffect(() => {
    if (!opened || pageCount === 0) return;
    const flushMs = setTimeout(() => flushProgress(false), 1200);
    const intervalMs = setInterval(() => flushProgress(false), 5000);
    return () => {
      clearTimeout(flushMs);
      clearInterval(intervalMs);
      flushProgress(true);
    };
    // Intentional: NO currentIndex in the deps — page turns must not tear this
    // down and flush an IPC on every step. The 5s interval + a final flush on
    // gallery change/unmount covers progress without per-page chatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened?.url, pageCount]);

  const goNext = useCallback(() => {
    const raw = Math.min(currentIndex + perScreen, Math.max(0, pageCount - 1));
    // Book mode: land on the next SPREAD start (cover alone, then aligned
    // pairs), otherwise the counter/highlight drift by one page.
    const next = settings.reading_mode === 'Book' ? spreadStart(raw, pageCount, perScreen) : raw;
    // Deliberate forward navigation may arm the end-of-chapter auto-advance.
    advanceArmedRef.current = true;
    setCurrentIndex(next);
    syncReadingPosition(next);
    if (settings.reading_mode === 'Scroll') setJumpTo({ index: next, offset: 0 });
  }, [currentIndex, perScreen, pageCount, settings.reading_mode, syncReadingPosition]);
  const goPrev = useCallback(() => {
    const raw = Math.max(0, currentIndex - perScreen);
    const next = settings.reading_mode === 'Book' ? spreadStart(raw, pageCount, perScreen) : raw;
    advanceArmedRef.current = false;
    setCurrentIndex(next);
    syncReadingPosition(next);
    if (settings.reading_mode === 'Scroll') setJumpTo({ index: next, offset: 0 });
  }, [currentIndex, perScreen, pageCount, settings.reading_mode, syncReadingPosition]);

  const setWidthBy = useCallback(
    (delta: number): void => {
      setSettings({ ...settings, width_scale: clampWidthScale(settings.width_scale + delta) });
    },
    [settings, setSettings],
  );
  const resetWidth = useCallback((): void => {
    setSettings({ ...settings, width_scale: WIDTH_SCALE_DEFAULT });
  }, [settings, setSettings]);

  useHotkeys(
    {
      onPrev: goPrev,
      onNext: goNext,
      onToggleThumbs: () => setSettings({ ...settings, show_thumbnails: !settings.show_thumbnails }),
      onToggleMode: () => setSettings({ ...settings, reading_mode: settings.reading_mode === 'Scroll' ? 'Book' : 'Scroll' }),
      onToggleHelp: () => setShowHelp((v) => !v),
      onToggleImmersive: () => {
        setHideToolbar((v) => {
          const next = !v;
          if (next) void document.documentElement.requestFullscreen().catch(() => {});
          else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          return next;
        });
      },
      onZoomIn: () => setWidthBy(0.05),
      onZoomOut: () => setWidthBy(-0.05),
      onZoomReset: resetWidth,
    },
    rtl,
    // Hotkeys must not drive the reader underneath an open dialog: arrows
    // silently paged while the chapter list was open, 'm'/'t' changed settings.
    showHelp || showChapters || showEhInfo || !!archive,
  );

  // The main process orders page loading by distance from the reading position;
  // it only learns that position from setReadingPosition (previously once per
  // 1.2-5 s flush), so a fast scroll/jump loaded pages around a stale target.
  const onVisible = useCallback(
    (i: number) => {
      if (!Number.isInteger(i)) return;
      // Any real page change means the user moved on: stop suppressing flushes.
      suppressFlushRef.current = false;
      setCurrentIndex(i);
      syncReadingPosition(i);
    },
    [syncReadingPosition],
  );
  const onJumpDone = useCallback(() => setJumpTo(null), []);

  // Flush the coalesced reading position when the reader unmounts, so the main
  // process's warm-ahead window follows the last page the user saw.
  useEffect(
    () => () => {
      if (posSyncTimerRef.current != null) {
        clearTimeout(posSyncTimerRef.current);
        posSyncTimerRef.current = null;
        const o = openedRef.current;
        if (o?.kind === 'online') void window.api.setReadingPosition(o.id, posSyncPendingRef.current);
      }
    },
    [],
  );

  // Whether the final screen of the gallery is on display. In Book mode the
  // visible spread may END on the last page while currentIndex (first page of
  // the spread) is not the last page — a plain `currentIndex === pageCount-1`
  // misses even page counts entirely.
  const atEnd = useMemo(
    () => isReaderAtEnd(currentIndex, pageCount, perScreen, settings.reading_mode),
    [currentIndex, pageCount, perScreen, settings.reading_mode],
  );

  // Mark chapter as fully read when reaching the last page.
  useEffect(() => {
    if (!opened || opened.kind !== 'online' || pageCount === 0) return;
    if (atEnd) window.api.markChapterRead(opened.url);
  }, [opened, atEnd, pageCount]);

  // Auto-advance to the next chapter after ~1s at the end (Scroll mode).
  // Guards: only fire when the user really is on the LAST page — a NaN or
  // stale currentIndex (transient observer report / gallery change) must
  // never legitimately open the next chapter on its own.
  // NOTE: no eager pre-warm of the next chapter — openUrl has side effects
  // (history update, library auto-add) and running it a page early made the
  // history row jump to an unread chapter ("continue from history" opened the
  // next one).
  const advancedRef = useRef(false);
  useEffect(() => {
    if (!opened || opened.kind !== 'online' || settings.reading_mode !== 'Scroll') return;
    const list = opened.chapterList;
    const idx = opened.chapterIndex;
    if (!list || idx == null) return;
    if (!Number.isInteger(currentIndex) || !Number.isInteger(pageCount) || pageCount === 0) return;
    if (currentIndex !== pageCount - 1) {
      advancedRef.current = false;
      return;
    }
    // Arriving at the last page via the slider/thumbnail/jump/restore must not
    // switch chapter: only real navigation (scroll, "next") arms this.
    if (!advanceArmedRef.current) return;
    if (advancedRef.current) return;
    const next = list[idx + 1];
    if (!next) return;
    advancedRef.current = true;
    advanceArmedRef.current = false;
    const mangaId = opened.mangaId;
    const coverUrl = opened.coverUrl;
    const t = setTimeout(() => {
      void (async () => {
        const r = await window.api.openUrl(next.chapter_id, 0, mangaId, coverUrl, null, idx + 1);
        if (r) {
          setOpened({
            kind: 'online',
            ...r,
            startPage: 0,
            coverUrl,
            chapterList: list,
            chapterIndex: idx + 1,
          });
        }
        advancedRef.current = false;
      })();
    }, 1000);
    return () => clearTimeout(t);
  }, [opened, currentIndex, pageCount, settings.reading_mode, setOpened]);

  const jump = useMemo(
    () => (): void => {
      const n = parseInt(jumpText, 10);
      if (isNaN(n)) return;
      const idx = Math.min(Math.max(0, n - 1), Math.max(0, pageCount - 1));
      // Book mode renders from currentIndex only — jumpTo is consumed by
      // ScrollView, so setting it alone made the page-number box do nothing
      // outside Scroll mode.
      advanceArmedRef.current = false;
      setCurrentIndex(idx);
      setJumpTo({ index: idx, offset: 0 });
      syncReadingPosition(idx);
    },
    [jumpText, pageCount, syncReadingPosition],
  );

  const openFolder = useCallback(async () => {
    const g = await window.api.pickFolder();
    if (g) setOpened({ kind: 'local', ...g, startPage: 0 });
  }, [setOpened]);

  const refreshFolder = useCallback(async () => {
    if (!opened || opened.kind !== 'local') return;
    const g = await window.api.rescanFolder(opened.url.slice('file://'.length));
    if (g) {
      setOpened({ kind: 'local', ...g, startPage: 0 });
      setJumpTo({ index: 0, offset: 0 });
    }
  }, [opened, setOpened]);

  const openUrl = useCallback(async () => {
    const url = urlText.trim();
    if (!url) return;
    setOpeningUrl(true);
    try {
      // Fresh settings: the renderer's read_progress snapshot can be hours old
      // (main writes it without broadcasting), so reopening a chapter read in
      // this session used to start at page 1 and overwrite the progress.
      const fresh = await window.api.getSettings();
      const saved = startPageFor(url, fresh.read_progress);
      const r = await window.api.openUrl(url, saved);
      if (r) {
        setOpened({ kind: 'online', ...r, startPage: saved });
        setUrlText('');
      } else {
        alert('Не удалось открыть URL');
      }
    } catch (e) {
      alert(`Не удалось открыть URL: ${errorText(e)}`);
    } finally {
      setOpeningUrl(false);
    }
  }, [urlText, setOpened]);

  const openChapter = useCallback(
    async (chapterId: string, chapterList: import('@shared/ipc').ChapterListItem[], chapterIndex: number) => {
      const current = opened?.kind === 'online' ? opened : null;
      try {
        // Fresh settings — see openUrl: the renderer snapshot is stale, so a
        // previously-read chapter reopened at page 1 and the progress was lost.
        const fresh = await window.api.getSettings();
        const saved = startPageFor(chapterId, fresh.read_progress);
        const r = await window.api.openUrl(chapterId, saved, current?.mangaId ?? null, current?.coverUrl ?? null, null, chapterIndex);
        if (r) {
          setOpened({ kind: 'online', ...r, startPage: saved, coverUrl: current?.coverUrl ?? null, chapterList, chapterIndex });
          setShowChapters(false);
        }
      } catch (e) {
        alert(`Не удалось открыть главу: ${errorText(e)}`);
      }
    },
    [opened, setOpened],
  );

  const openArchiveBuy = useCallback(async () => {
    if (opened?.kind !== 'online') return;
    setArchiveBusy(true);
    try {
      const cost = await window.api.ehArchiveCost(opened.url);
      if (!cost) {
        alert('Не удалось получить страницу архива');
        return;
      }
      setArchiveDltype(cost.options[0]?.key ?? 'org');
      setArchive(cost);
    } catch (e) {
      alert(`Архив: ${errorText(e)}`);
    } finally {
      setArchiveBusy(false);
    }
  }, [opened]);

  const buyArchive = useCallback(async () => {
    if (!archive || opened?.kind !== 'online') return;
    setArchiveBusy(true);
    try {
      const r = await window.api.ehArchiveBuy(opened.url, archiveDltype);
      if (!r?.downloadUrl) {
        alert('Не удалось купить архив (нет ссылки на скачивание)');
        return;
      }
      const task = await window.api.downloadsAddArchive(opened.url, opened.title, r.downloadUrl);
      if (!task) {
        alert('Такая галерея уже есть в загрузках');
        return;
      }
      setArchive(null);
      alert('Архив скачивается в Downloads');
    } catch (e) {
      alert(`Архив: ${errorText(e)}`);
    } finally {
      setArchiveBusy(false);
    }
  }, [archive, archiveDltype, opened]);

  return (
    <div className={`reader${hideToolbar ? ' immersive' : ''}`}>
      <div className="reader-toolbar">
        <button className="rt-btn rt-btn-labeled" onClick={openFolder} title="Открыть папку с галереей">
          <svg viewBox="0 0 24 24" className="rt-icon" aria-hidden="true">
            <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H10l2 2.5h6.5A1.5 1.5 0 0 1 20 11v6.5A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
          </svg>
          <span>Открыть</span>
        </button>
        {opened?.kind === 'local' && (
          <button className="rt-btn rt-btn-icon" onClick={() => void refreshFolder()} title="Обновить папку" aria-label="Обновить папку">
            <svg viewBox="0 0 24 24" className="rt-icon" aria-hidden="true">
              <path d="M19 12a7 7 0 1 1-2.1-5M19 4v4h-4" />
            </svg>
          </button>
        )}

        <div className="rt-heading">
          <span className="reader-title" title={opened?.title ?? undefined}>
            {opened?.title ?? 'Нет галереи'}
          </span>
          {opened?.kind === 'online' && opened.source && <span className="rt-source">{opened.source}</span>}
        </div>

        <div className="rt-group">
          <select
            className="rt-select"
            value={settings.reading_mode}
            onChange={(e) => setSettings({ ...settings, reading_mode: e.target.value as 'Scroll' | 'Book' })}
            title="Режим чтения"
          >
            <option value="Scroll">Лента</option>
            <option value="Book">Книга</option>
          </select>
        </div>

        <div className="rt-group rt-zoom">
          <button className="rt-btn rt-btn-step" onClick={() => setWidthBy(-0.05)} title="Уменьшить масштаб (−)">
            −
          </button>
          <span className="rt-value">{Math.round(settings.width_scale * 100)}%</span>
          <button className="rt-btn rt-btn-step" onClick={() => setWidthBy(0.05)} title="Увеличить масштаб (+)">
            +
          </button>
          <span className="rt-divider" />
          <button className="rt-btn rt-btn-icon" onClick={resetWidth} title="Масштаб по умолчанию" aria-label="Масштаб по умолчанию">
            <svg viewBox="0 0 24 24" className="rt-icon" aria-hidden="true">
              <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 5v4h4" />
            </svg>
          </button>
        </div>

        {opened?.kind === 'online' && (
          <div className="rt-group">
            <button className="rt-btn rt-btn-labeled rt-btn-compact" onClick={() => setShowChapters(true)} title="Список глав">
              <svg viewBox="0 0 24 24" className="rt-icon" aria-hidden="true">
                <path d="M5 7h14M5 12h14M5 17h9" />
              </svg>
              <span>Главы</span>
            </button>
            <button
              className="rt-btn rt-btn-labeled rt-btn-compact"
              title="Добавить в библиотеку"
              onClick={() =>
                void (async () => {
                  await window.api.libraryAdd({
                    url: opened.url,
                    title: opened.title,
                    coverUrl: opened.coverUrl ?? null,
                    source: opened.source,
                    seriesId: opened.mangaId ?? opened.url,
                  });
                })()
              }
            >
              <svg viewBox="0 0 24 24" className="rt-icon" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>В библиотеку</span>
            </button>
            {(opened.source.includes('ExHentai') || opened.source.includes('E-Hentai')) && (
              <button className="rt-btn rt-btn-labeled rt-btn-compact" onClick={() => setShowEhInfo(true)} title="Инфо, торренты, H@H">
                <svg viewBox="0 0 24 24" className="rt-icon" aria-hidden="true">
                  <path d="M12 8v.01M11 11.5h1v6h1" />
                  <circle cx="12" cy="12" r="8.5" />
                </svg>
                <span>Инфо</span>
              </button>
            )}
            {(opened.source.includes('ExHentai') || opened.source.includes('E-Hentai')) && (
              <button className="rt-btn rt-btn-labeled rt-btn-compact" disabled={archiveBusy} onClick={() => void openArchiveBuy()} title="Скачать архив галереи">
                <svg viewBox="0 0 24 24" className="rt-icon" aria-hidden="true">
                  <path d="M12 4v10.5M7.5 10.5 12 15l4.5-4.5M4.5 18.5h15" />
                </svg>
                <span>Архив</span>
              </button>
            )}
          </div>
        )}

        {opened && (
          <div className="rt-group">
            <button
              className="rt-btn rt-btn-labeled rt-btn-compact rt-btn-quiet"
              onClick={() => {
                if (!opened) return;
                // Reset means "this chapter has not been read": page 1 of N.
                // The old call persisted 0/1 and was immediately overwritten by
                // the periodic flush (and by the final flush on leaving), so the
                // button looked dead in History/Library.
                suppressFlushRef.current = true;
                savedRef.current = { url: opened.url, page: 0, off: 0 };
                void window.api.recordProgress(opened.url, 1, Math.max(1, pageCount), 0);
              }}
              title="Сбросить прогресс этой главы"
            >
              <svg viewBox="0 0 24 24" className="rt-icon" aria-hidden="true">
                <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 5v4h4" />
              </svg>
              <span>Сбросить</span>
            </button>
          </div>
        )}

        <div className="spacer" />

        <div className="rt-group rt-url">
          <input
            className="rt-input"
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder="MangaDex / ExHentai URL или UUID"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void openUrl();
            }}
          />
          <button className="rt-btn" disabled={openingUrl} onClick={() => void openUrl()} title="Открыть по ссылке">
            Открыть
          </button>
        </div>

        <div className="rt-group rt-pages">
          <span className="rt-value rt-page-count" title="Текущая страница">
            {pageCount === 0 ? 0 : currentIndex + 1}
            <span className="rt-sep">/</span>
            {pageCount}
          </span>
          <input
            className="rt-input rt-jump"
            value={jumpText}
            onChange={(e) => setJumpText(e.target.value)}
            placeholder="№"
            aria-label="Номер страницы"
            onKeyDown={(e) => {
              if (e.key === 'Enter') jump();
            }}
          />
          <button className="rt-btn" onClick={jump} title="Перейти к странице">
            →
          </button>
        </div>
      </div>

      {!opened && <div className="screen">Открой папку кнопкой «Открыть» на панели сверху или вставь ссылку в поле справа</div>}

      {opened && (
        <div className="reader-body">
          {settings.show_thumbnails && (
            <ThumbnailPanel
              galleryId={opened.id}
              pageCount={pageCount}
              currentIndex={currentIndex}
              thumbSize={settings.thumb_size}
              onSelect={(i) => {
                advanceArmedRef.current = false;
                setCurrentIndex(i);
                setJumpTo({ index: i, offset: 0 });
                syncReadingPosition(i);
              }}
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
                onVisiblePos={onVisiblePos}
                onJumpDone={onJumpDone}
                onUserScroll={onUserScroll}
              />
            )}
            {settings.reading_mode === 'Book' && (
              <BookView
                galleryId={opened.id}
                pageCount={pageCount}
                currentIndex={currentIndex}
                pagesPerScreen={perScreen}
                direction={settings.book_direction}
                pageMargin={settings.page_margin}
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
                onChange={(e) => {
                  const v = Number(e.target.value) - 1;
                  advanceArmedRef.current = false;
                  setCurrentIndex(v);
                  setJumpTo({ index: v, offset: 0 });
                  syncReadingPosition(v);
                }}
              />
            )}
          </div>
        </div>
      )}

      {showEhInfo && opened?.kind === 'online' && <EhInfoModal url={opened.url} onClose={() => setShowEhInfo(false)} />}
      {showChapters && opened?.kind === 'online' && opened.mangaId && (
        <ChapterListModal
          mangaId={opened.mangaId}
          currentUrl={opened.url}
          onClose={() => setShowChapters(false)}
          onOpenChapter={async (chapterId, chapterList, chapterIndex) => {
            await openChapter(chapterId, chapterList, chapterIndex);
          }}
        />
      )}

      {showHelp && (
        <div className="overlay" onClick={() => setShowHelp(false)}>
          <div ref={helpDialogRef} className="overlay-card" role="dialog" aria-modal="true" aria-label="Горячие клавиши" onClick={(e) => e.stopPropagation()}>
            <h3>Keyboard Shortcuts</h3>
            <ul>
              <li>← / A — Previous page{rtl ? ' (RTL: next)' : ''}</li>
              <li>→ / D — Next page{rtl ? ' (RTL: prev)' : ''}</li>
              <li>↑ / W — Previous screen</li>
              <li>↓ / S — Next screen</li>
              <li>T — Toggle thumbnails</li>
              <li>M — Toggle reading mode</li>
              <li>+ / − — Zoom (Scroll)</li>
              <li>0 — Reset zoom</li>
              <li>H / F — Fullscreen (immersive)</li>
              <li>? — Toggle this help (Esc closes)</li>
            </ul>
          </div>
        </div>
      )}

      {archive && opened?.kind === 'online' && (
        <div
          className="overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !archiveBusy) setArchive(null);
          }}
        >
          <div ref={archiveDialogRef} className="overlay-card archive-buy" role="dialog" aria-modal="true" aria-labelledby="archive-buy-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="archive-buy-title">Скачать архив</h3>
            <p>{archive.costGp != null ? `Стоимость: ${archive.costGp} GP.` : 'Стоимость неизвестна.'}</p>
            {archive.options.length > 0 && (
              <label className="row">
                Формат:
                <select value={archiveDltype} onChange={(e) => setArchiveDltype(e.target.value)}>
                  {archive.options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label || o.key}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="row">
              <button disabled={archiveBusy} onClick={() => void buyArchive()}>
                {archiveBusy ? 'Покупаю…' : 'Купить и скачать'}
              </button>
              <button disabled={archiveBusy} onClick={() => setArchive(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
