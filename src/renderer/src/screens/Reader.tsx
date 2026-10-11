import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startPageFor, startScrollFor } from '@shared/settings';
import type { ArchiveCost } from '@shared/ipc';
import { useStore } from '../state/store';
import { useHotkeys } from '../hooks/useHotkeys';
import ScrollView from '../components/ScrollView';
import BookView from '../components/BookView';
import ThumbnailPanel from '../components/ThumbnailPanel';
import ChapterListModal from '../components/ChapterListModal';
import { isReaderAtEnd, clampWidthScale, WIDTH_SCALE_DEFAULT } from './reader/viewMath';

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

  const perScreen = Math.max(1, settings.pages_per_screen);
  const pageCount = opened?.pageCount ?? 0;
  const rtl = settings.reading_mode === 'Book' && settings.book_direction === 'Rtl';
  const webtoon = opened?.kind === 'online' && !!opened.webtoon;
  const [hideToolbar, setHideToolbar] = useState(false);

  useEffect(() => {
    // New gallery: forget the previous chapter's in-page offset until the user
    // actually scrolls (offsetDirty gate in flushProgress protects the stored
    // value from being overwritten by race/restore flushes).
    offRef.current = 0;
    offsetDirtyRef.current = false;
    const last = Math.max(0, pageCount - 1);
    const sp = opened?.startPage ?? 0;
    // Clamp the restored position: a gallery that shrank (rescan, shorter
    // chapter) must never show Pg outside 1..pageCount.
    const idx = Math.min(Math.max(0, Number.isFinite(sp) ? sp : 0), last);
    setCurrentIndex(idx);
    // Jump the ScrollView to the restored position — otherwise it sits on
    // the top of the document, the observer fires for page 1 and the saved
    // progress is silently reset to the first page. Webtoons additionally
    // restore the vertical offset saved inside the page (fetched fresh, so a
    // re-open within the same session sees the latest position too).
    const key = opened?.url ?? '';
    void window.api.getSettings().then((fresh) => {
      const off = startScrollFor(key, fresh.read_scroll);
      setJumpTo(idx > 0 || off > 0 ? { index: idx, offset: off } : null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, pageCount]);

  useEffect(() => {
    if (!showHelp) return;
    const fn = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setShowHelp(false);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [showHelp]);

  // Progress is flushed like JHenTai does: a periodic timer + a final write
  // when the reader (or gallery) closes — not an IPC on every scroll tick.
  const idxRef = useRef(0);
  const savedRef = useRef<{ url: string; page: number; off: number | undefined }>({ url: '', page: -1, off: undefined });
  idxRef.current = currentIndex;
  const offRef = useRef(0);
  const offsetDirtyRef = useRef(false);
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
      const page = idxRef.current + 1;
      const off = offsetDirtyRef.current ? offRef.current : undefined;
      if (!immediate && page === savedRef.current.page && o.url === savedRef.current.url && off === savedRef.current.off) return;
      savedRef.current = { url: o.url, page, off };
      // Also informs the main process so warm-ahead (load pages ~32 forward)
      // re-centers around the current position.
      if (o.kind === 'online') window.api.setReadingPosition(o.id, idxRef.current);
      window.api.recordProgress(o.url, page, pageCount, offRef.current);
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
    const next = Math.min(currentIndex + perScreen, Math.max(0, pageCount - 1));
    setCurrentIndex(next);
    if (settings.reading_mode === 'Scroll') setJumpTo({ index: next, offset: 0 });
  }, [currentIndex, perScreen, pageCount, settings.reading_mode]);
  const goPrev = useCallback(() => {
    const next = Math.max(0, currentIndex - perScreen);
    setCurrentIndex(next);
    if (settings.reading_mode === 'Scroll') setJumpTo({ index: next, offset: 0 });
  }, [currentIndex, perScreen, settings.reading_mode]);

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
  );

  const onVisible = useCallback((i: number) => {
    if (Number.isInteger(i)) setCurrentIndex(i);
  }, []);
  const onJumpDone = useCallback(() => setJumpTo(null), []);

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
    if (advancedRef.current) return;
    const next = list[idx + 1];
    if (!next) return;
    advancedRef.current = true;
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
      if (!isNaN(n)) setJumpTo({ index: Math.min(Math.max(0, n - 1), Math.max(0, pageCount - 1)), offset: 0 });
    },
    [jumpText, pageCount],
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
      const saved = startPageFor(url, settings.read_progress);
      const r = await window.api.openUrl(url, saved);
      if (r) {
        setOpened({ kind: 'online', ...r, startPage: saved });
        setUrlText('');
      } else {
        alert('Не удалось открыть URL');
      }
    } catch (e: any) {
      alert(`Не удалось открыть URL: ${e?.message ?? e}`);
    } finally {
      setOpeningUrl(false);
    }
  }, [urlText, settings.read_progress, setOpened]);

  const openChapter = useCallback(
    async (chapterId: string, chapterList: import('@shared/ipc').ChapterListItem[], chapterIndex: number) => {
      const current = opened?.kind === 'online' ? opened : null;
      try {
        const saved = startPageFor(chapterId, settings.read_progress);
        const r = await window.api.openUrl(chapterId, saved, current?.mangaId ?? null, current?.coverUrl ?? null, null, chapterIndex);
        if (r) {
          setOpened({ kind: 'online', ...r, startPage: saved, coverUrl: current?.coverUrl ?? null, chapterList, chapterIndex });
          setShowChapters(false);
        }
      } catch (e: any) {
        alert(`Не удалось открыть главу: ${e?.message ?? e}`);
      }
    },
    [opened, settings.read_progress, setOpened],
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
    } finally {
      setArchiveBusy(false);
    }
  }, [archive, archiveDltype, opened]);

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
        <button onClick={() => setWidthBy(-0.05)} title="Уменьшить масштаб (−)">
          −
        </button>
        <span className="muted">{Math.round(settings.width_scale * 100)}%</span>
        <button onClick={() => setWidthBy(0.05)} title="Увеличить масштаб (+)">
          +
        </button>
        <button onClick={resetWidth} title="Сбросить масштаб (0)">
          100%
        </button>
        {opened?.kind === 'online' && <button onClick={() => setShowChapters(true)}>Главы</button>}
        {opened?.kind === 'online' && (
          <button
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
            ＋ Library
          </button>
        )}
        {opened && (
          <button onClick={() => void window.api.recordProgress(opened.url, 0, 1, 0)} title="Сбросить прогресс этой главы">
            Сбросить
          </button>
        )}
        {opened?.kind === 'online' && (opened.source.includes('ExHentai') || opened.source.includes('E-Hentai')) && (
          <button disabled={archiveBusy} onClick={() => void openArchiveBuy()}>
            ⬇ Archive
          </button>
        )}
        <div className="spacer" />
        <input
          className="url-input"
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
          placeholder="MangaDex / ExHentai URL или UUID"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void openUrl();
          }}
          style={{ width: 210 }}
        />
        <button disabled={openingUrl} onClick={() => void openUrl()}>
          URL
        </button>
        <span className="muted">
          Pg {pageCount === 0 ? 0 : currentIndex + 1}/{pageCount}
        </span>
        <input
          value={jumpText}
          onChange={(e) => setJumpText(e.target.value)}
          placeholder="#"
          style={{ width: 44 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') jump();
          }}
        />
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
              onSelect={(i) => {
                setCurrentIndex(i);
                setJumpTo({ index: i, offset: 0 });
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
                onChange={(e) => {
                  const v = Number(e.target.value) - 1;
                  setCurrentIndex(v);
                  setJumpTo({ index: v, offset: 0 });
                }}
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
            await openChapter(chapterId, chapterList, chapterIndex);
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
              <li>+ / − — Zoom (Scroll)</li>
              <li>0 — Reset zoom</li>
              <li>H / F — Fullscreen (immersive)</li>
              <li>? — Toggle this help</li>
            </ul>
          </div>
        </div>
      )}

      {archive && opened?.kind === 'online' && (
        <div className="overlay" onClick={() => !archiveBusy && setArchive(null)}>
          <div className="overlay-card archive-buy">
            <h3>Скачать архив</h3>
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
