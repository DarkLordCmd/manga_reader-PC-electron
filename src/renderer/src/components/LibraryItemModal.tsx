import { errorText } from '../lib/errors';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChapterListItem } from '@shared/ipc';
import type { LibraryItem, ReadingStatus } from '@shared/library';
import { READING_STATUSES } from '@shared/library';
import { chapterLabelNumber, displayWorkTitle, likelySameWork } from '@shared/work-title';
import { tagChipStyle } from '../lib/tag-colors';
import { isAdultWork, mangashiTitleUrl } from '../lib/adult';
import { useStore } from '../state/store';
import { useChapterDownloads } from '../lib/use-chapter-downloads';
import { useBodyScrollLock, useDialogFocus } from '../lib/use-modal';
import ChapterDownloadButton from './ChapterDownloadButton';

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Читаю',
  planned: 'В планах',
  completed: 'Прочитано',
  on_hold: 'Отложено',
  dropped: 'Брошено',
};

export interface ExternalSource {
  source: string;
  title: string;
  url: string;
  coverUrl: string | null;
  kind: string | null;
  adult: boolean;
  /** 18+ age rating: not the R34 category, but still hidden when R34 is off. */
  age18: boolean;
}
const externalCache = new Map<string, { at: number; items: ExternalSource[] }>();
const EXTERNAL_TTL_MS = 10 * 60_000;

/** Chapter URLs differ only by a trailing slash between calls. */
const normUrl = (u: string): string => u.trim().replace(/\/+$/, '').toLowerCase();

interface Props {
  item: LibraryItem;
  /** Greatest read chapter across duplicate sources; marks earlier chapters read. */
  progressIndex?: number | null;
  /** Other library rows with the same normalized title (different sources). */
  alternatives?: LibraryItem[];
  onSwitchSource?: (item: LibraryItem) => void;
  /** Add/switch to a work found in another catalogue. */
  onUseExternal?: (ext: ExternalSource) => Promise<void> | void;
  onClose: () => void;
  onOpen: () => void;
  /** The full chapter list travels with the click: the reader needs it for the
   * chapter panel and for auto-advance to the next chapter. */
  onOpenChapter: (chapterId: string, index: number, chapters: ChapterListItem[]) => void;
  onChanged: () => void;
}

export default function LibraryItemModal({ item, progressIndex, alternatives = [], onSwitchSource, onUseExternal, onClose, onOpen, onOpenChapter, onChanged }: Props): JSX.Element {
  const { settings } = useStore();
  const [status, setStatus] = useState<ReadingStatus | ''>(item.status ?? '');
  const [rating, setRating] = useState(item.rating ?? 0);
  const [note, setNote] = useState(item.note);
  const [tags, setTags] = useState(item.tags.join(', '));
  const [chapters, setChapters] = useState<ChapterListItem[] | null>(null);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [workTags, setWorkTags] = useState<string[]>([]);
  const [externalSources, setExternalSources] = useState<ExternalSource[]>([]);
  const [externalBusy, setExternalBusy] = useState<string | null>(null);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [externalSearchError, setExternalSearchError] = useState<string | null>(null);
  const [externalRetry, setExternalRetry] = useState(0);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useDialogFocus(onClose, closeRef);
  const downloads = useChapterDownloads();
  useBodyScrollLock();

  // The work may exist on another source even if it was never imported there.
  // Ask the other catalogue(s) by title and match the source slug, so the card
  // can list "есть на Senkuro/Remanga" instead of showing only the active one.
  useEffect(() => {
    let cancelled = false;
    const known = new Set(alternatives.map((a) => a.source));
    const current = item.source.toLowerCase();
    const allowExternalAdult = settings.show_r34_history && item.category === 'r34';
    const isExternalVisible = (x: Pick<ExternalSource, 'source' | 'adult' | 'age18'>): boolean =>
      !known.has(x.source) && (allowExternalAdult || (!isAdultWork(x) && !x.age18));
    const targets = [
      { key: 'remanga', label: 'Remanga' },
      { key: 'senkuro', label: 'Senkuro' },
      { key: 'mangashi', label: 'Manga-shi' },
      { key: 'mangalib', label: 'Mangalib' },
      { key: 'comx', label: 'Com-X' },
      { key: 'readmanga', label: 'Readmanga' },
      { key: 'mintmanga', label: 'Mintmanga' },
      { key: 'mangapoisk', label: 'Mangapoisk' },
    ].filter((t) => !current.includes(t.key.replace('mangashi', 'manga-shi').replace('comx', 'com-x')) && !known.has(t.label));
    if (targets.length === 0) {
      setExternalSources([]);
      setExternalLoading(false);
      setExternalSearchError(null);
      return;
    }
    const query = displayWorkTitle(item.title);
    const cacheKey = `${item.url}|${query}`;
    const cached = externalCache.get(cacheKey);
    if (cached && Date.now() - cached.at < EXTERNAL_TTL_MS) {
      setExternalSources(cached.items.filter(isExternalVisible));
      setExternalLoading(false);
      setExternalSearchError(null);
      return;
    }
    setExternalSources([]);
    setExternalLoading(true);
    setExternalSearchError(null);
    void (async () => {
      const found: ExternalSource[] = [];
      let failedSearches = 0;
      await Promise.all(
        targets.map(async (t) => {
          try {
            const cards = await window.api.searchCatalog(t.key, query, 0, 'default', {}, undefined);
            const match = cards.find(
              (c) =>
                (allowExternalAdult || (!isAdultWork(c) && !c.age18)) &&
                likelySameWork({ url: item.url, title: item.title }, { url: c.url, title: c.title }),
            );
            if (match && !known.has(t.label)) {
              const ext: ExternalSource = {
                source: t.label,
                title: match.title,
                url: match.url,
                coverUrl: match.coverUrl ?? null,
                kind: match.kind ?? null,
                adult: match.adult === true,
                age18: match.age18 === true,
              };
              found.push(ext);
              if (!cancelled) {
                setExternalSources((prev) => [...prev.filter((x) => x.source !== ext.source), ext].filter(isExternalVisible));
              }
            }
          } catch {
            failedSearches += 1;
          }
        }),
      );
      if (cancelled) return;
      if (failedSearches === targets.length) {
        setExternalSearchError('Не удалось найти внешние источники. Проверьте соединение и повторите.');
        setExternalLoading(false);
        return;
      }
      externalCache.set(cacheKey, { at: Date.now(), items: found });
      setExternalSources(found.filter(isExternalVisible));
      setExternalLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [item.key, item.url, item.title, item.source, item.category, alternatives, settings.show_r34_history, externalRetry]);

  const switchExternalSource = async (ext: ExternalSource): Promise<void> => {
    if (!onUseExternal || externalBusy) return;
    setExternalBusy(ext.url);
    setExternalError(null);
    try {
      await onUseExternal(ext);
    } catch (e) {
      setExternalError(errorText(e));
    } finally {
      setExternalBusy(null);
    }
  };

  useEffect(() => {
    // Reset only when another work is opened; settings broadcasts while the
    // user is editing must not overwrite unsaved field values.
    setStatus(item.status ?? '');
    setRating(item.rating ?? 0);
    setNote(item.note);
    setTags(item.tags.join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.key]);

  // Chapter list for the title behind this row. Manga-shi keeps the chapter URL
  // in `url`, so the title URL is derived from it.
  const [chapterRetry, setChapterRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setChapters(null);
    setChapterError(null);
    // The chapter list belongs to the SERIES: item.url is the chapter currently
    // being read (…/chapter/<id>), and asking for chapters by that URL made
    // Senkuro answer an empty `manga` ("не удалось определить ветку").
    const source = /manga-shi\./i.test(item.url) ? mangashiTitleUrl(item.url) : item.seriesId || item.url;
    window.api
      .fetchChapterList(source)
      .then((list) => {
        if (!cancelled) setChapters(list);
      })
      .catch((e) => {
        if (!cancelled) setChapterError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [item.key, item.url, item.seriesId, chapterRetry]);

  // Tags of the work itself, as the source lists them (Manga-shi exposes them
  // through schema.org JSON-LD on the title page).
  useEffect(() => {
    let cancelled = false;
    setWorkTags([]);
    // The chapter list belongs to the SERIES: item.url is the chapter currently
    // being read (…/chapter/<id>), and asking for chapters by that URL made
    // Senkuro answer an empty `manga` ("не удалось определить ветку").
    const source = /manga-shi\./i.test(item.url) ? mangashiTitleUrl(item.url) : item.seriesId || item.url;
    window.api
      .catalogTags(source)
      .then((t) => {
        if (!cancelled) setWorkTags(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item.key, item.url, item.seriesId]);

  // Scroll the list to the chapter the row points at (long titles open on
  // chapter 1 otherwise). Layout effect: rAF is throttled while the window is
  // occluded, which would leave the list at the top.
  const readUpTo = progressIndex ?? item.chapterIndex;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !chapters) return;
    const current = list.querySelector<HTMLElement>('.chapter-item.resume') ?? list.querySelector<HTMLElement>('.chapter-item.current');
    if (!current) return;
    const r = current.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    list.scrollTop += r.top - l.top - list.clientHeight / 2 + r.height / 2;
    // Snap to a row boundary so the list never starts with half a chapter.
    const rowH = (list.querySelector('.chapter-row') as HTMLElement | null)?.offsetHeight ?? 0;
    if (rowH > 0) list.scrollTop = Math.round(list.scrollTop / rowH) * rowH;
  }, [chapters, readUpTo]);

  const save = async (): Promise<void> => {
    if (actionBusy) return;
    setActionBusy('save');
    setActionError(null);
    try {
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
    } catch (e) {
      setActionError(`Не удалось сохранить: ${errorText(e)}`);
    } finally {
      setActionBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (actionBusy) return;
    setActionBusy('remove');
    setActionError(null);
    try {
      await window.api.libraryRemove(item.key);
      onChanged();
    } catch (e) {
      setActionError(`Не удалось убрать из библиотеки: ${errorText(e)}`);
      setActionBusy(null);
    }
  };

  const deleteEntry = async (): Promise<void> => {
    if (actionBusy || !window.confirm('Удалить запись из истории и библиотеки?')) return;
    setActionBusy('delete');
    setActionError(null);
    try {
      await window.api.libraryDelete(item.key);
      onChanged();
    } catch (e) {
      setActionError(`Не удалось удалить запись: ${errorText(e)}`);
      setActionBusy(null);
    }
  };

  const currentUrl = normUrl(item.url);

  return (
    <div
      className="overlay"
      // Only the backdrop closes: dragging from inside the card (note selection,
      // rating slider, textarea resize handle) and releasing outside emitted a
      // click on the overlay and discarded unsaved edits.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="overlay-card library-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-item-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overlay-head">
          <h3 id="library-item-title" className="overlay-title" title={item.title}>
            {displayWorkTitle(item.title) || 'Без названия'}
          </h3>
          <button ref={closeRef} className="overlay-close" aria-label="Закрыть" title="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>

        {(alternatives.length > 1 || externalSources.length > 0 || externalLoading || externalSearchError) && (
          <div className="modal-sources">
            <span className="field-label">Источник</span>
            {alternatives.map((a) => (
              <button
                key={a.key}
                type="button"
                className={`source-chip${a.key === item.key ? ' active' : ''}`}
                aria-pressed={a.key === item.key}
                disabled={actionBusy != null}
                title={a.url}
                onClick={() => onSwitchSource?.(a)}
              >
                {a.source}
                {a.chapterLabel ? ` · гл. ${chapterLabelNumber(a.chapterLabel) ?? a.chapterLabel}` : ''}
              </button>
            ))}
            {externalLoading && (
              <span className="source-chip external loading">Ищу источники…</span>
            )}
            {externalSources.map((e) => (
              <button
                key={`${e.source}:${e.url}`}
                type="button"
                className="source-chip external"
                disabled={externalBusy !== null || actionBusy != null}
                title={`Переключиться на ${e.source}: ${e.title}`}
                onClick={() => void switchExternalSource(e)}
              >
                {externalBusy === e.url ? 'Переключаю…' : `${e.source} · есть`}
              </button>
            ))}
          </div>
        )}
        {externalSearchError && (
          <div className="chapter-error-row">
            <span className="error-text">{externalSearchError}</span>
            <button className="btn-ghost" onClick={() => setExternalRetry((n) => n + 1)}>
              Повторить
            </button>
          </div>
        )}
        {externalError && <div className="overlay-note error-text">{externalError}</div>}

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
              {chapterError && (
                <div className="chapter-error-row">
                  <span className="error-text">{chapterError}</span>
                  <button className="btn-ghost" onClick={() => setChapterRetry((n) => n + 1)}>
                    Повторить
                  </button>
                </div>
              )}
              {chapters && chapters.length === 0 && <div className="overlay-note">Глав не найдено</div>}
              {chapters &&
                chapters.map((c, i) => {
                  const isCurrent = normUrl(c.chapter_id) === currentUrl;
                  const explicitlyRead = settings.read_chapters.includes(c.chapter_id);
                  const inferredRead = readUpTo != null && i <= readUpTo;
                  const isRead = explicitlyRead || inferredRead;
                  const inferredOnly = inferredRead && !explicitlyRead;
                  const isResume = readUpTo != null && i === readUpTo;
                  const chapterNum = chapterLabelNumber(c.chapter_num) ?? c.chapter_num;
                  return (
                    <div key={c.chapter_id} className={`chapter-row${isRead ? ' read' : ''}${isResume ? ' resume' : ''}`}>
                      <button
                        className={`chapter-item${isCurrent ? ' current' : ''}${isResume ? ' resume' : ''}`}
                        title={c.title ? `${chapterNum} — ${c.title}` : chapterNum}
                        onClick={() => {
                          setActionError(null);
                          void Promise.resolve(onOpenChapter(c.chapter_id, i, chapters)).catch((e) => {
                            setActionError(`Не удалось открыть главу: ${errorText(e)}`);
                          });
                        }}
                      >
                        <span className="chapter-num">{chapterNum}</span>
                        {c.title ? <span className="chapter-name">{c.title}</span> : null}
                      </button>
                      <ChapterDownloadButton
                        state={downloads.stateOf(c.chapter_id)}
                        onDownload={() => void downloads.download(c.chapter_id)}
                      />
                      <button
                        className={`chapter-toggle${isRead ? ' on' : ''}`}
                        title={inferredOnly ? 'Прочитано по прогрессу; явная отметка не задана' : isRead ? 'Снять отметку «прочитано»' : 'Отметить прочитанной'}
                        aria-label={inferredOnly ? 'Прочитано по прогрессу; явная отметка не задана' : isRead ? 'Снять отметку «прочитано»' : 'Отметить прочитанной'}
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

        {actionError && (
          <div className="overlay-note error-text" role="alert">
            {actionError}
          </div>
        )}
        <div className="overlay-actions">
          <button className="btn-danger" disabled={actionBusy != null} onClick={() => void remove()}>
            {actionBusy === 'remove' ? 'Убираю…' : 'Убрать из библиотеки'}
          </button>
          <button className="btn-danger" disabled={actionBusy != null} onClick={() => void deleteEntry()}>
            {actionBusy === 'delete' ? 'Удаляю…' : 'Удалить из истории'}
          </button>
          <span className="actions-spacer" />
          <button className="btn-secondary" disabled={actionBusy != null} onClick={onOpen}>
            Открыть
          </button>
          <button className="btn-primary" disabled={actionBusy != null} onClick={() => void save()}>
            {actionBusy === 'save' ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}
