import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { LibraryItem, LibrarySort, ReadingStatus } from '@shared/library';
import { READING_STATUSES } from '@shared/library';
import LibraryItemModal, { type ExternalSource } from '../components/LibraryItemModal';
import CoverImg from '../components/CoverImg';
import KindBadge from '../components/KindBadge';
import StatusBadge from '../components/StatusBadge';
import ContextMenu from '../components/ContextMenu';
import { buildLibraryMenuItems, STATUS_LABELS } from '../lib/library-menu';
import { mangashiTitleUrl, resolveAdultFlag } from '../lib/adult';
import { errorText } from '../lib/errors';
import { chapterLabelNumber, displayWorkTitle, groupLikelyWorks } from '@shared/work-title';

const TABS: (ReadingStatus | 'all')[] = ['all', ...READING_STATUSES];

const SORTS: [LibrarySort, string][] = [
  ['last_read', 'Последнее чтение'],
  ['title', 'Название'],
  ['rating', 'Оценка'],
  ['added', 'Добавлено'],
];

/** Group identity must survive sorting, search and source filtering. */
function canonicalGroupKey(group: LibraryItem[]): string {
  return JSON.stringify(group.map((item) => item.key).sort());
}

function chapterPositionOf(item: LibraryItem): number {
  const label = chapterLabelNumber(item.chapterLabel);
  return item.chapterIndex ?? (label != null ? Number(label) : -1);
}

/** Chapter position is authoritative; page only breaks ties within a chapter. */
function compareProgress(a: LibraryItem, b: LibraryItem): number {
  const chapterDiff = chapterPositionOf(a) - chapterPositionOf(b);
  if (chapterDiff !== 0) return chapterDiff;
  const pageDiff = (a.currentPage || 0) - (b.currentPage || 0);
  if (pageDiff !== 0) return pageDiff;
  return a.key.localeCompare(b.key);
}

function bestProgressItem(items: LibraryItem[]): LibraryItem {
  return items.reduce((best, item) => (compareProgress(item, best) > 0 ? item : best));
}

function pluralSources(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'источников';
  if (mod10 === 1) return 'источник';
  if (mod10 >= 2 && mod10 <= 4) return 'источника';
  return 'источников';
}

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
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null);
  const selectionEpoch = useRef(0);
  const cat = settings.show_r34_history ? category : 'main';

  const chooseSelected = (item: LibraryItem | null): void => {
    selectionEpoch.current += 1;
    setSelected(item);
  };

  // Typing in the search box fires a request per keystroke; a slower answer for
  // an older query must not overwrite the newer one (the list and the tab
  // counters flashed results that did not match the visible query).
  const refreshSeq = useRef(0);
  const refresh = useCallback(() => {
    const effCat = settings.show_r34_history ? category : 'main';
    const seq = ++refreshSeq.current;
    setLoading(true);
    setListError(null);
    void Promise.allSettled([
      window.api.libraryList({ status: 'all', search, sort, category: effCat }),
      window.api.libraryList({ status: 'all', category: effCat }),
    ]).then(([visibleResult, allResult]) => {
      if (seq !== refreshSeq.current) return;
      setLoading(false);
      if (visibleResult.status === 'rejected') {
        setListError(errorText(visibleResult.reason));
        return;
      }
      if (allResult.status === 'rejected') {
        setListError(errorText(allResult.reason));
        return;
      }
      setItems(visibleResult.value);
      setAllItems(allResult.value);
    });
  }, [search, sort, category, settings.show_r34_history]);

  useEffect(refresh, [refresh]);
  useEffect(() => window.api.onLibraryChanged(refresh), [refresh]);

  const workGroups = useMemo(() => groupLikelyWorks(allItems), [allItems]);
  const groupKeyByItem = useMemo(() => {
    const m = new Map<string, string>();
    for (const group of workGroups) {
      const key = canonicalGroupKey(group);
      for (const item of group) m.set(item.key, key);
    }
    return m;
  }, [workGroups]);
  const groupMembersByKey = useMemo(() => {
    const m = new Map<string, LibraryItem[]>();
    for (const group of workGroups) m.set(canonicalGroupKey(group), group);
    return m;
  }, [workGroups]);
  // A duplicate work belongs to exactly one tab: use the status of its most
  // advanced member, with a stable key tie-breaker, for both counts and cards.
  const workStatuses = useMemo(() => {
    const m = new Map<string, ReadingStatus | null>();
    for (const group of workGroups) m.set(canonicalGroupKey(group), bestProgressItem(group).status);
    return m;
  }, [workGroups]);

  const dupDisplayRef = useRef<Map<string, { best: LibraryItem; count: number }>>(new Map());

  const useExternalSource = async (ext: ExternalSource): Promise<void> => {
    const epoch = selectionEpoch.current;
    const selectedStatus = selected?.status;
    const norm = (u: string): string => u.replace(/\/+$/, '').toLowerCase();
    const existing = allItems.find((i) => norm(i.url) === norm(ext.url));
    if (existing) {
      chooseSelected(existing);
      return;
    }
    const added = await window.api.libraryAdd({
      url: ext.url,
      title: ext.title,
      coverUrl: ext.coverUrl,
      source: ext.source,
      seriesId: ext.url,
      kind: ext.kind ?? null,
      adult: ext.adult,
    });
    if (selectedStatus) await window.api.librarySetStatus(added.key, selectedStatus);
    // Closing, reopening or switching source while the IPC calls were pending
    // must not let this old request reopen or replace the newer picker.
    if (epoch !== selectionEpoch.current) return;
    chooseSelected(added);
  };

  const open = async (item: LibraryItem): Promise<void> => {
    setError(null);
    try {
      // For a work present on several sources, continue from the GREATEST
      // progress of the group (the card shows that number too), not from this
      // row's smaller progress. The chapter list still comes from the selected
      // source, so switching source keeps the resume point.
      const resume = dupDisplayRef.current.get(item.key)?.best ?? item;
      if (resume.chapterIndex != null) {
        try {
          const source = /manga-shi\./i.test(item.url) ? mangashiTitleUrl(item.url) : item.seriesId || item.url;
          const [list] = await Promise.all([window.api.fetchChapterList(source), window.api.getSettings()]);
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
    // Unique works per source: duplicates share one card.
    const m = new Map<string, Set<string>>();
    for (const it of allItems) {
      if (!it.source) continue;
      const key = groupKeyByItem.get(it.key) ?? `key:${it.key}`;
      const set = m.get(it.source) ?? new Set<string>();
      set.add(key);
      m.set(it.source, set);
    }
    return [...m.entries()].map(([src, set]) => [src, set.size] as [string, number]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [allItems, groupKeyByItem]);
  const allSourceTotal = useMemo(
    () => new Set(allItems.map((it) => groupKeyByItem.get(it.key) ?? `key:${it.key}`)).size,
    [allItems, groupKeyByItem],
  );
  const filteredAll = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((it) => (!q || it.title.toLowerCase().includes(q)) && (sources.size === 0 || sources.has(it.source)));
  }, [allItems, search, sources]);
  const visibleItems = useMemo(
    () =>
      items.filter((it) => {
        if (sources.size > 0 && !sources.has(it.source)) return false;
        const groupStatus = workStatuses.get(groupKeyByItem.get(it.key) ?? `key:${it.key}`) ?? it.status;
        return status === 'all' || groupStatus === status;
      }),
    [items, sources, status, workStatuses, groupKeyByItem],
  );
  const filteredCounts = useMemo(() => {
    // Count each work once, under the same single status used by the tabs.
    const seen = new Set<string>();
    const c: Record<string, number> = {};
    for (const it of filteredAll) {
      const key = groupKeyByItem.get(it.key) ?? `key:${it.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const groupStatus = workStatuses.get(key) ?? it.status;
      if (!groupStatus) continue;
      c[groupStatus] = (c[groupStatus] ?? 0) + 1;
    }
    return c;
  }, [filteredAll, groupKeyByItem, workStatuses]);
  const filteredTotal = useMemo(
    () => new Set(filteredAll.map((it) => groupKeyByItem.get(it.key) ?? `key:${it.key}`)).size,
    [filteredAll, groupKeyByItem],
  );

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
    const out = new Map<string, { best: LibraryItem; count: number }>();
    for (const group of workGroups) {
      if (group.length < 2) continue;
      const best = bestProgressItem(group);
      for (const it of group) out.set(it.key, { best, count: group.length });
    }
    return out;
  }, [workGroups]);
  dupDisplayRef.current = duplicateDisplay;
  // One card per work even when several sources have the same normalized title.
  // The visible matching member supplies identity; duplicateDisplay only
  // supplies the group's maximum progress and source count.
  const groupedItems = useMemo(() => {
    const groups = new Map<string, LibraryItem[]>();
    for (const it of visibleItems) {
      const key = groupKeyByItem.get(it.key) ?? `key:${it.key}`;
      const members = groups.get(key) ?? [];
      members.push(it);
      groups.set(key, members);
    }
    return [...groups.entries()].map(([key, members]) => {
      const best = bestProgressItem(members);
      const dup = duplicateDisplay.get(best.key);
      return { key, item: best, count: dup?.count ?? members.length, status: workStatuses.get(key) ?? best.status };
    });
  }, [visibleItems, duplicateDisplay, groupKeyByItem, workStatuses]);

  const alternatives = useMemo(() => {
    if (!selected) return [];
    const key = groupKeyByItem.get(selected.key);
    if (key == null) return [selected];
    return groupMembersByKey.get(key) ?? [selected];
  }, [selected, groupKeyByItem, groupMembersByKey]);
  const hasFilters = search.trim() || status !== 'all' || sources.size > 0;

  return (
    <div className="screen library">
      <div className="library-toolbar">
        <button className={cat === 'main' ? 'tab active' : 'tab'} aria-pressed={cat === 'main'} onClick={() => setCategory('main')}>
          📖 Main
        </button>
        {settings.show_r34_history && (
          <button className={cat === 'r34' ? 'tab active' : 'tab'} aria-pressed={cat === 'r34'} onClick={() => setCategory('r34')}>
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
          <button className={`source-chip${sources.size === 0 ? ' active' : ''}`} aria-pressed={sources.size === 0} onClick={() => setSources(new Set())}>
            Все ({allSourceTotal})
          </button>
          {sourceStats.map(([src, n]) => (
            <button
              key={src}
              className={`source-chip${sources.has(src) ? ' active' : ''}`}
              aria-pressed={sources.has(src)}
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
            <button key={t} className={`tab${status === t ? ' active' : ''}`} aria-pressed={status === t} onClick={() => setStatus(t)}>
              {label} ({n})
            </button>
          );
        })}
      </div>

      {error && <div className="error-text">{error}</div>}
      {listError && (
        <div className="error-text">
          {listError}{' '}
          <button className="btn-ghost" onClick={refresh}>
            Повторить
          </button>
        </div>
      )}
      {loading ? (
        <div className="muted">Загрузка библиотеки…</div>
      ) : !listError && groupedItems.length === 0 ? (
        <div className="muted">{hasFilters ? 'Ничего не найдено по выбранным фильтрам' : 'В библиотеке пока пусто'}</div>
      ) : null}
      <div className="history-grid">
        {groupedItems.map(({ key, item: it, count, status: groupStatus }) => {
          const best = duplicateDisplay.get(it.key);
          return (
          <div
            key={key}
            className="history-card"
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, item: groupStatus ? { ...it, status: groupStatus } : it });
            }}
          >
            <button
              type="button"
              className="card-open"
              aria-label={`Открыть ${displayWorkTitle(it.title) || 'Без названия'}`}
              onClick={() => chooseSelected(it)}
            />
            <div className="history-cover">
              <CoverImg url={it.coverUrl} className={settings.blur_adult_covers && it.category === 'r34' ? 'blur-adult' : undefined} />
              <KindBadge kind={it.kind} />
              <StatusBadge status={groupStatus} />
            </div>
            <div className="history-title" title={it.title}>
              {displayWorkTitle(it.title) || 'Без названия'}
            </div>
            <div className="history-meta">
              <span>
                {/* One compact line: chapter progress or page progress, never a
                    second counter row (that left a mostly empty row + gap on
                    R34 cards). */}
                {(() => {
                  const progress = best?.best ?? it;
                  const raw = progress.chapterLabel;
                  const label = chapterLabelNumber(raw) ?? raw;
                  return label
                    ? `Глава ${label}${progress.chapterTotal ? ` из ${progress.chapterTotal}` : ''}`
                    : progress.totalPages > 0
                      ? `стр. ${progress.currentPage}/${progress.totalPages}`
                      : '';
                })()}
                {it.rating != null ? ` · ★ ${it.rating}` : ''}
                {best && count > 1 ? ` · ${count} ${pluralSources(count)}` : ''}
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
          progressIndex={selected ? (duplicateDisplay.get(selected.key)?.best.chapterIndex ?? selected.chapterIndex) : null}
          alternatives={alternatives}
          onSwitchSource={(next) => chooseSelected(next)}
          onUseExternal={useExternalSource}
          onClose={() => chooseSelected(null)}
          onOpen={async () => {
            await open(selected);
            chooseSelected(null);
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
            if (!r) throw new Error('источник недоступен или не поддерживается');
            // Carry the list + position: without them the reader cannot show
            // the chapter panel or auto-advance at the end of the chapter.
            setOpened({ kind: 'online', ...r, startPage: 0, coverUrl: selected.coverUrl, chapterList, chapterIndex: index });
            setScreen('Reader');
            chooseSelected(null);
          }}
          onChanged={() => {
            chooseSelected(null);
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
              adult: menu.item.category === 'r34',
            },
            { key: menu.item.key, favorited: menu.item.favoritedAt !== null, status: menu.item.status },
          )}
        />
      )}
    </div>
  );
}
