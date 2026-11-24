import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { LibraryItem, LibrarySort, ReadingStatus } from '@shared/library';
import { READING_STATUSES } from '@shared/library';
import LibraryItemModal from '../components/LibraryItemModal';
import CoverImg from '../components/CoverImg';
import KindBadge from '../components/KindBadge';
import StatusBadge from '../components/StatusBadge';
import ContextMenu, { type MenuItem } from '../components/ContextMenu';
import { buildLibraryMenuItems, STATUS_LABELS } from '../lib/library-menu';
import { resolveAdultFlag } from '../lib/adult';
import { errorText } from '../lib/errors';
import { normalizeWorkTitle, chapterLabelNumber } from '@shared/work-title';

const TABS: (ReadingStatus | 'all')[] = ['all', ...READING_STATUSES];

const SORTS: [LibrarySort, string][] = [
  ['last_read', 'Последнее чтение'],
  ['title', 'Название'],
  ['rating', 'Оценка'],
  ['added', 'Добавлено'],
];

export default function Library(): JSX.Element {
  const { setScreen, setOpened, settings } = useStore();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [allItems, setAllItems] = useState<LibraryItem[]>([]);
  const [status, setStatus] = useState<ReadingStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LibrarySort>('last_read');
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [category, setCategory] = useState<'main' | 'r34'>('main');
  const [sources, setSources] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null);
  const cat = settings.show_r34_history ? category : 'main';

  // Typing in the search box fires a request per keystroke; a slower answer for
  // an older query must not overwrite the newer one (the list and the tab
  // counters flashed results that did not match the visible query).
  const refreshSeq = useRef(0);
  const refresh = useCallback(() => {
    const effCat = settings.show_r34_history ? category : 'main';
    const seq = ++refreshSeq.current;
    void window.api.libraryList({ status, search, sort, category: effCat }).then((r) => {
      if (seq === refreshSeq.current) setItems(r);
    });
    void window.api.libraryList({ status: 'all', category: effCat }).then((r) => {
      if (seq === refreshSeq.current) setAllItems(r);
    });
  }, [status, search, sort, category, settings.show_r34_history]);

  useEffect(refresh, [refresh]);
  useEffect(() => window.api.onLibraryChanged(refresh), [refresh]);

  const open = async (item: LibraryItem): Promise<void> => {
    setError(null);
    try {
      // For a work present on several sources, continue from the GREATEST
      // progress of the group (the card shows that number too), not from this
      // row's smaller progress. The chapter list still comes from the selected
      // source, so switching source keeps the resume point.
      const resume = duplicateDisplay.get(item.key)?.best ?? item;
      if (resume.chapterIndex != null) {
        try {
          const [list] = await Promise.all([window.api.fetchChapterList(item.url), window.api.getSettings()]);
          const idx = Math.min(Math.max(0, resume.chapterIndex), Math.max(0, list.length - 1));
          const chapter = list[idx];
          if (chapter) {
            const start = Math.max(0, resume.currentPage - 1);
            const r = await window.api.openUrl(
              chapter.chapter_id,
              start,
              item.seriesId,
              item.coverUrl,
              item.kind ?? null,
              idx,
              await resolveAdultFlag(item.url, item.category === 'r34'),
            );
            if (r) {
              setOpened({ kind: 'online', ...r, startPage: start, coverUrl: item.coverUrl, chapterList: list, chapterIndex: idx });
              setScreen('Reader');
              return;
            }
          }
        } catch {
          /* fall back to the series entry below */
        }
      }
      const start = Math.max(0, resume.currentPage - 1);
      const r = await window.api.openUrl(item.url, start, item.seriesId, item.coverUrl, item.kind ?? null, null, await resolveAdultFlag(item.url, item.category === 'r34'));
      if (r) {
        setOpened({ kind: 'online', ...r, startPage: start, coverUrl: item.coverUrl });
        setScreen('Reader');
      } else {
        // openUrl returns null for an unsupported/unavailable source; the old
        // code just did nothing, so the button looked broken.
        setError(`Не удалось открыть «${item.title}»: источник недоступен или не поддерживается`);
      }
    } catch (e) {
      setError(errorText(e));
    }
  };


  // Sources present in the current Main/R34 scope, with counts. The filter is
  // applied locally: the library is already fully loaded, and multi-select
  // source chips should not trigger a DB query per toggle.
  const sourceStats = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of allItems) if (it.source) m.set(it.source, (m.get(it.source) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [allItems]);
  const filteredAll = useMemo(
    () => (sources.size === 0 ? allItems : allItems.filter((it) => sources.has(it.source))),
    [allItems, sources],
  );
  const visibleItems = useMemo(
    () => (sources.size === 0 ? items : items.filter((it) => sources.has(it.source))),
    [items, sources],
  );
  const filteredCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of filteredAll) if (it.status) c[it.status] = (c[it.status] ?? 0) + 1;
    return c;
  }, [filteredAll]);
  const filteredTotal = filteredAll.length;

  // A source can disappear when switching Main/R34; drop stale selections so
  // the grid does not stay empty with no matching chip.
  useEffect(() => {
    setSources((prev) => {
      if (prev.size === 0) return prev;
      const available = new Set(allItems.map((i) => i.source));
      if ([...prev].every((s) => available.has(s))) return prev;
      return new Set([...prev].filter((s) => available.has(s)));
    });
  }, [allItems]);

  const toggleSource = (src: string): void => {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  };

  // Same work on several sources: keep both rows (so the user can choose where
  // to read), but show the greatest read-chapter progress of the group.
  const duplicateDisplay = useMemo(() => {
    const groups = new Map<string, LibraryItem[]>();
    for (const it of allItems) {
      const key = normalizeWorkTitle(it.title);
      if (key.length < 4) continue;
      const list = groups.get(key) ?? [];
      list.push(it);
      groups.set(key, list);
    }
    const progressNumber = (i: LibraryItem): number => {
      const label = chapterLabelNumber(i.chapterLabel);
      return Math.max(label != null ? Number(label) : -1, i.chapterIndex ?? -1, i.currentPage || 0);
    };
    const score = progressNumber;
    const out = new Map<string, { best: LibraryItem; count: number }>();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const best = group.reduce((a, b) => {
        const diff = score(b) - score(a);
        if (diff !== 0) return diff > 0 ? b : a;
        // Same position but one label is "1 / 148" and another is a stale "2":
        // keep the one whose numeric label is higher so the card shows 148.
        const la = chapterLabelNumber(a.chapterLabel);
        const lb = chapterLabelNumber(b.chapterLabel);
        return (lb != null ? Number(lb) : -1) > (la != null ? Number(la) : -1) ? b : a;
      });
      for (const it of group) out.set(it.key, { best, count: group.length });
    }
    return out;
  }, [allItems]);

  const alternatives = useMemo(() => {
    if (!selected) return [];
    const key = normalizeWorkTitle(selected.title);
    if (key.length < 4) return [selected];
    const list = allItems.filter((i) => normalizeWorkTitle(i.title) === key);
    return list.some((i) => i.key === selected.key) ? list : [selected, ...list];
  }, [selected, allItems]);

  return (
    <div className="screen library">
      <div className="library-toolbar">
        <button className={cat === 'main' ? 'tab active' : 'tab'} onClick={() => setCategory('main')}>
          📖 Main
        </button>
        {settings.show_r34_history && (
          <button className={cat === 'r34' ? 'tab active' : 'tab'} onClick={() => setCategory('r34')}>
            🔞 R34
          </button>
        )}
        <div className="spacer" />
        <input className="catalog-search" placeholder="Поиск по названию…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)}>
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {sourceStats.length > 0 && (
        <div className="library-sources">
          <span className="library-sources-label">Источники</span>
          <button className={`source-chip${sources.size === 0 ? ' active' : ''}`} onClick={() => setSources(new Set())}>
            Все ({allItems.length})
          </button>
          {sourceStats.map(([src, n]) => (
            <button
              key={src}
              className={`source-chip${sources.has(src) ? ' active' : ''}`}
              onClick={() => toggleSource(src)}
            >
              {src} ({n})
            </button>
          ))}
        </div>
      )}

      <div className="library-tabs">
        {TABS.map((t) => {
          const label = t === 'all' ? 'Все' : STATUS_LABELS[t];
          const n = t === 'all' ? filteredTotal : (filteredCounts[t] ?? 0);
          return (
            <button key={t} className={`tab${status === t ? ' active' : ''}`} onClick={() => setStatus(t)}>
              {label} ({n})
            </button>
          );
        })}
      </div>

      {error && <div className="error-text">{error}</div>}
      {visibleItems.length === 0 && (
        <div className="muted">{search.trim() || status !== 'all' ? 'Ничего не найдено' : 'В библиотеке пока пусто'}</div>
      )}
      <div className="history-grid">
        {visibleItems.map((it) => {
          const best = duplicateDisplay.get(it.key);
          return (
          <div
            key={it.key}
            className="history-card"
            onClick={() => setSelected(it)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, item: it });
            }}
          >
            <div className="history-cover">
              <CoverImg url={it.coverUrl} className={settings.blur_adult_covers && it.category === 'r34' ? 'blur-adult' : undefined} />
              <KindBadge kind={it.kind} />
              <StatusBadge status={it.status} />
            </div>
            <div className="history-title" title={it.title}>
              {it.title || 'Без названия'}
            </div>
            <div className="history-meta">
              <span>
                {/* One compact line: chapter progress or page progress, never a
                    second counter row (that left a mostly empty row + gap on
                    R34 cards). */}
                {(() => {
                  const raw = best?.best.chapterLabel ?? it.chapterLabel;
                  const label = chapterLabelNumber(raw) ?? raw;
                  return label
                    ? `Глава ${label}${(best?.best.chapterTotal ?? it.chapterTotal) ? ` из ${best?.best.chapterTotal ?? it.chapterTotal}` : ''}`
                    : it.totalPages > 0
                      ? `стр. ${it.currentPage}/${it.totalPages}`
                      : '';
                })()}
                {it.rating != null ? ` · ★ ${it.rating}` : ''}
                {best && best.count > 1 ? ` · источников: ${best.count}` : ''}
              </span>
              <button
                className="continue-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  void open(it);
                }}
              >
                Открыть
              </button>
            </div>
            {it.note && (
              <div className="library-note muted" title={it.note}>
                {it.note}
              </div>
            )}
          </div>
          );
        })}
      </div>

      {selected && (
        <LibraryItemModal
          item={selected}
          alternatives={alternatives}
          onSwitchSource={(next) => setSelected(next)}
          onClose={() => setSelected(null)}
          onOpen={async () => {
            await open(selected);
            setSelected(null);
          }}
          onOpenChapter={async (chapterId, index, chapterList) => {
            const r = await window.api.openUrl(
              chapterId,
              0,
              selected.seriesId,
              selected.coverUrl,
              selected.kind ?? null,
              index,
              await resolveAdultFlag(selected.url, selected.category === 'r34'),
            );
            if (r) {
              // Carry the list + position: without them the reader cannot show
              // the chapter panel or auto-advance at the end of the chapter.
              setOpened({ kind: 'online', ...r, startPage: 0, coverUrl: selected.coverUrl, chapterList, chapterIndex: index });
              setScreen('Reader');
              setSelected(null);
            }
          }}
          onChanged={() => {
            setSelected(null);
            refresh();
          }}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={buildLibraryMenuItems(
            {
              url: menu.item.url,
              title: menu.item.title,
              coverUrl: menu.item.coverUrl,
              source: menu.item.source,
              seriesId: menu.item.seriesId,
              kind: menu.item.kind,
            },
            { key: menu.item.key, favorited: menu.item.favoritedAt !== null, status: menu.item.status },
          )}
        />
      )}
    </div>
  );
}
