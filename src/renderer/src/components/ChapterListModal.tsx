import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import type { ChapterListItem } from '@shared/ipc';

interface Props {
  mangaId: string;
  currentUrl: string;
  onOpenChapter: (chapterId: string, chapterList: ChapterListItem[], chapterIndex: number) => void;
  onClose: () => void;
}

export default function ChapterListModal({ mangaId, currentUrl, onOpenChapter, onClose }: Props): JSX.Element {
  const { settings } = useStore();
  const [chapters, setChapters] = useState<ChapterListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api
      .fetchChapterList(mangaId)
      .then((c) => {
        if (!cancelled) setChapters(c);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [mangaId]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card chapters" onClick={(e) => e.stopPropagation()}>
        <h3>Главы</h3>
        <div className="chapter-list">
          {error && <div className="error-text">{error}</div>}
          {!chapters && !error && <div>Загрузка…</div>}
          {chapters && <div className="chapter-count muted">Всего глав: {chapters.length}</div>}
          {chapters &&
            chapters.map((c, i) => {
              const isCurrent = c.chapter_id === currentUrl;
              const isRead = settings.read_chapters.includes(c.chapter_id);
              const label = c.title ? `${c.chapter_num} — ${c.title}` : c.chapter_num;
              const cls = ['chapter-item', isCurrent ? ' current' : '', isRead ? ' read' : ''].join('');
              return (
                <button key={c.chapter_id} className={cls} onClick={() => onOpenChapter(c.chapter_id, chapters, i)}>
                  {isRead ? '✓ ' : ''}
                  {label}
                </button>
              );
            })}
        </div>
        <button onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}
