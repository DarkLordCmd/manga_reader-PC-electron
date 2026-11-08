import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChapterListItem } from '@shared/ipc';
import type { LibraryItem, ReadingStatus } from '@shared/library';
import { READING_STATUSES } from '@shared/library';
import { tagChipStyle } from '../lib/tag-colors';
import { mangashiTitleUrl } from '../lib/adult';
import { useStore } from '../state/store';
import { useChapterDownloads } from '../lib/use-chapter-downloads';
import ChapterDownloadButton from './ChapterDownloadButton';

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Читаю',
  planned: 'В планах',
  completed: 'Прочитано',
  on_hold: 'Отложено',
  dropped: 'Брошено',
};

/** Chapter URLs differ only by a trailing slash between calls. */
const normUrl = (u: string): string => u.trim().replace(/\/+$/, '').toLowerCase();

interface Props {
  item: LibraryItem;
  onClose: () => void;
  onOpen: () => void;
  onOpenChapter: (chapterId: string, index: number) => void;
  onChanged: () => void;
}

export default function LibraryItemModal({ item, onClose, onOpen, onOpenChapter, onChanged }: Props): JSX.Element {
  const { settings } = useStore();
  const [status, setStatus] = useState<ReadingStatus | ''>(item.status ?? '');
  const [rating, setRating] = useState(item.rating ?? 0);
  const [note, setNote] = useState(item.note);
  const [tags, setTags] = useState(item.tags.join(', '));
  const [chapters, setChapters] = useState<ChapterListItem[] | null>(null);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [workTags, setWorkTags] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const downloads = useChapterDownloads();

  useEffect(() => {
    setStatus(item.status ?? '');
    setRating(item.rating ?? 0);
    setNote(item.note);
    setTags(item.tags.join(', '));
  }, [item.key]);

  // Chapter list for the title behind this row. Manga-shi keeps the chapter URL
  // in `url`, so the title URL is derived from it.
  useEffect(() => {
    let cancelled = false;
    setChapters(null);
    setChapterError(null);
    const source = /manga-shi\./i.test(item.url) ? mangashiTitleUrl(item.url) : item.url;
    window.api
      .fetchChapterList(source)
      .then((list) => {
        if (!cancelled) setChapters(list);
      })
      .catch((e) => {
        if (!cancelled) setChapterError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [item.key, item.url]);

  // Tags of the work itself, as the source lists them (Manga-shi exposes them
  // through schema.org JSON-LD on the title page).
  useEffect(() => {
    let cancelled = false;
    setWorkTags([]);
    const source = /manga-shi\./i.test(item.url) ? mangashiTitleUrl(item.url) : item.url;
    window.api
      .catalogTags(source)
      .then((t) => {
        if (!cancelled) setWorkTags(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item.key, item.url]);

  // Scroll the list to the chapter the row points at (long titles open on
  // chapter 1 otherwise). Layout effect: rAF is throttled while the window is
  // occluded, which would leave the list at the top.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !chapters) return;
    const current = list.querySelector<HTMLElement>('.chapter-item.current');
    if (!current) return;
    const r = current.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    list.scrollTop += r.top - l.top - list.clientHeight / 2 + r.height / 2;
    // Snap to a row boundary so the list never starts with half a chapter.
    const rowH = (list.querySelector('.chapter-row') as HTMLElement | null)?.offsetHeight ?? 0;
    if (rowH > 0) list.scrollTop = Math.round(list.scrollTop / rowH) * rowH;
  }, [chapters]);

  const save = async (): Promise<void> => {
    await window.api.librarySetStatus(item.key, status === '' ? null : status);
    await window.api.librarySetRating(item.key, rating > 0 ? rating : null);
    await window.api.librarySetNote(item.key, note);
    await window.api.librarySetTags(
      item.key,
      tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    );
    onChanged();
  };

  const currentUrl = normUrl(item.url);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card library-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h3 className="overlay-title" title={item.title}>
            {item.title || 'Без названия'}
          </h3>
          <button className="overlay-close" aria-label="Закрыть" title="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="overlay-meta">
          {item.source && <span className="overlay-chip">{item.source}</span>}
          {item.kind && <span className="overlay-chip">{item.kind}</span>}
          {item.category === 'r34' && (
            <span className="overlay-tag" style={tagChipStyle('18+')}>
              18+
            </span>
          )}
          {item.totalPages > 0 && (
            <span>
              стр. {Math.max(1, item.currentPage)}/{item.totalPages}
            </span>
          )}
        </div>

        <div className="modal-body">
          {workTags.length > 0 && (
            <div className="modal-section">
              <div className="modal-section-head">
                <span className="field-label">Теги произведения</span>
                <span className="modal-section-count">{workTags.length}</span>
              </div>
              <div className="overlay-tags modal-work-tags" title={workTags.join(', ')}>
                {workTags.slice(0, 24).map((t) => (
                  <span key={t} className="overlay-tag" style={tagChipStyle(t)}>
                    {t}
                  </span>
                ))}
                {workTags.length > 24 && <span className="overlay-tag more">+{workTags.length - 24}</span>}
              </div>
            </div>
          )}

          <div className="modal-section">
            <div className="modal-section-head">
              <span className="field-label">Главы</span>
              {chapters && <span className="modal-section-count">{chapters.length}</span>}
            </div>
            <div className="chapter-list modal-chapters" ref={listRef}>
              {!chapters && !chapterError && <div className="overlay-note">Загрузка глав…</div>}
              {chapterError && <div className="error-text">{chapterError}</div>}
              {chapters &&
                chapters.map((c, i) => {
                  const isCurrent = normUrl(c.chapter_id) === currentUrl;
                  const isRead = settings.read_chapters.includes(c.chapter_id);
                  return (
                    <div key={c.chapter_id} className={`chapter-row${isRead ? ' read' : ''}`}>
                      <button
                        className={`chapter-item${isCurrent ? ' current' : ''}`}
                        title={c.title ? `${c.chapter_num} — ${c.title}` : c.chapter_num}
                        onClick={() => onOpenChapter(c.chapter_id, i)}
                      >
                        <span className="chapter-num">{c.chapter_num}</span>
                        {c.title ? <span className="chapter-name">{c.title}</span> : null}
                      </button>
                      <ChapterDownloadButton
                        state={downloads.stateOf(c.chapter_id)}
                        onDownload={() => void downloads.download(c.chapter_id)}
                      />
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

          <div className="modal-fields">
            <div className="field">
              <label className="field-label" htmlFor="lib-status">
                Статус
              </label>
              <select id="lib-status" className="field-input" value={status} onChange={(e) => setStatus(e.target.value as ReadingStatus | '')}>
                <option value="">— не в библиотеке —</option>
                {READING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="lib-rating">
                Оценка <span className="field-value">{rating > 0 ? `${rating}/10` : '—'}</span>
              </label>
              <input
                id="lib-rating"
                className="field-range"
                type="range"
                min={0}
                max={10}
                step={1}
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="lib-note">
                Заметка
              </label>
              <textarea id="lib-note" className="field-input field-area" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="lib-tags">
                Мои теги <span className="field-hint">через запятую</span>
              </label>
              <input id="lib-tags" className="field-input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="романтика, драма, …" />
            </div>
          </div>
        </div>

        <div className="overlay-actions">
          <button
            className="btn-danger"
            onClick={async () => {
              await window.api.libraryRemove(item.key);
              onChanged();
            }}
          >
            Убрать из библиотеки
          </button>
          <button
            className="btn-danger"
            onClick={async () => {
              if (!window.confirm('Удалить запись из истории и библиотеки?')) return;
              await window.api.libraryDelete(item.key);
              onChanged();
            }}
          >
            Удалить из истории
          </button>
          <span className="actions-spacer" />
          <button className="btn-secondary" onClick={onOpen}>
            ▶ Открыть
          </button>
          <button className="btn-primary" onClick={() => void save()}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
