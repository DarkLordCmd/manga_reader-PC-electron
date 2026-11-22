import { errorText } from '../lib/errors';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { ChapterListItem } from '@shared/ipc';
import ChapterDownloadButton from './ChapterDownloadButton';
import { useChapterDownloads } from '../lib/use-chapter-downloads';
import { useBodyScrollLock } from '../lib/use-modal';

interface Props {
  mangaId: string;
  currentUrl: string;
  onOpenChapter: (chapterId: string, chapterList: ChapterListItem[], chapterIndex: number) => void;
  onClose: () => void;
}

/** Chapter URLs differ only by a trailing slash between calls. */
const normUrl = (u: string): string => u.trim().replace(/\/+$/, '').toLowerCase();

export default function ChapterListModal({ mangaId, currentUrl, onOpenChapter, onClose }: Props): JSX.Element {
  const { settings } = useStore();
  const [chapters, setChapters] = useState<ChapterListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const downloads = useChapterDownloads();
  const listRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useBodyScrollLock();

  // Escape closes; focus moves into the dialog so Tab does not walk the hidden
  // sidebar/toolbar behind the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    window.api
      .fetchChapterList(mangaId)
      .then((c) => {
        if (!cancelled) setChapters(c);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [mangaId]);

  // Open on the chapter being read, not at chapter 1.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !chapters) return;
    const current = list.querySelector<HTMLElement>('.chapter-item.current');
    if (!current) return;
    const r = current.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    list.scrollTop += r.top - l.top - list.clientHeight / 2 + r.height / 2;
    const rowH = (list.querySelector('.chapter-row') as HTMLElement | null)?.offsetHeight ?? 0;
    if (rowH > 0) list.scrollTop = Math.round(list.scrollTop / rowH) * rowH;
  }, [chapters, currentUrl]);

  return (
    <div
      className="overlay"
      // Only a click ON THE BACKDROP closes: a drag that starts inside the card
      // (text selection, scrollbar, resize handle) and ends outside used to fire
      // a click on the overlay and close the dialog.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="overlay-card chapters" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h3 className="overlay-title">Главы</h3>
          <button ref={closeRef} className="overlay-close" aria-label="Закрыть" title="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="overlay-meta">
          {chapters ? <span>Глав: {chapters.length}</span> : <span>Загружаю список…</span>}
        </div>

        <div className="chapter-list" ref={listRef}>
          {error && <div className="error-text">{error}</div>}
          {!chapters && !error && <div className="overlay-note">Загрузка…</div>}
          {chapters &&
            chapters.map((c, i) => {
              const isCurrent = normUrl(c.chapter_id) === normUrl(currentUrl);
              const isRead = settings.read_chapters.includes(c.chapter_id);
              const label = c.title ? `${c.chapter_num} — ${c.title}` : c.chapter_num;
              const cls = ['chapter-item', isCurrent ? ' current' : '', isRead ? ' read' : ''].join(' ');
              const dl = downloads.stateOf(c.chapter_id);
              return (
                <div key={c.chapter_id} className={`chapter-row${isRead ? ' read' : ''}`}>
                  <button className={cls} title={label} onClick={() => onOpenChapter(c.chapter_id, chapters, i)}>
                    {label}
                  </button>
                  <ChapterDownloadButton state={dl} onDownload={() => void downloads.download(c.chapter_id)} />
                  <button
                    className={`chapter-toggle${isRead ? ' on' : ''}`}
                    title={isRead ? 'Снять отметку «прочитано»' : 'Отметить прочитанной'}
                    aria-label={isRead ? 'Снять отметку «прочитано»' : 'Отметить прочитанной'}
                    aria-pressed={isRead}
                    onClick={() => void window.api.setChapterRead(c.chapter_id, !isRead)}
                  >
                    {isRead ? '✓' : '○'}
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
