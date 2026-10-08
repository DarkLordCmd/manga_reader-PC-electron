import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogCard, CatalogCursor, CatalogFilters, ChapterListItem, ExAccount } from '@shared/ipc';
import type { ReadingStatus } from '@shared/library';
import type { MenuItem } from '../../components/ContextMenu';
import { buildLibraryMenuItems } from '../../lib/library-menu';
import { useStore } from '../../state/store';
import { R34_SOURCES, SOURCES } from './constants';

interface CatalogMenu {
  x: number;
  y: number;
  card: CatalogCard;
  lookup: { key: string; favorited: boolean; status: ReadingStatus | null } | null;
}

export function useCatalogSearch() {
  const { setScreen, setOpened, settings, setSettings } = useStore();
  const [source, setSource] = useState(() => {
    const s = settings.last_catalog_source || 'mangadex';
    return !settings.show_r34_history && R34_SOURCES.includes(s) ? 'mangadex' : s;
  });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('relevance');
  const [page, setPage] = useState(0);
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<CatalogCard | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[] | null>(null);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [ehTags, setEhTags] = useState<{ display: string }[]>([]);
  const [nhTags, setNhTags] = useState<{ name: string; count: number }[]>([]);
  const [exAccounts, setExAccounts] = useState<ExAccount[]>([]);
  const [exCurrentId, setExCurrentId] = useState(0);
  const [exNotice, setExNotice] = useState<string | null>(null);
  const [qsOpen, setQsOpen] = useState(false);
  const [quickSearchSeq, setQuickSearchSeq] = useState(0);
  const [statuses, setStatuses] = useState<Record<string, ReadingStatus>>({});

  // ── Filters ──
  const [ehExcludedCats, setEhExcludedCats] = useState(0);
  const [ehMinRating, setEhMinRating] = useState(0);
  const [msSort, setMsSort] = useState('');
  const [msStatus, setMsStatus] = useState('');
  const [msType, setMsType] = useState('');
  const [msYear, setMsYear] = useState('');
  const [msAge, setMsAge] = useState('');
  const [msChaptersMin, setMsChaptersMin] = useState('');
  const [msChaptersMax, setMsChaptersMax] = useState('');
  const [msTags, setMsTags] = useState<string[]>([]);
  const [rmOrdering, setRmOrdering] = useState('');
  const [rmStatus, setRmStatus] = useState('');
  const [rmTypes, setRmTypes] = useState('');
  const [rmGenres, setRmGenres] = useState<string[]>([]);
  const [skOrdering, setSkOrdering] = useState('');
  const [skStatus, setSkStatus] = useState<string[]>([]);
  const [skType, setSkType] = useState<string[]>([]);
  const [skFormat, setSkFormat] = useState<string[]>([]);
  const [skRating, setSkRating] = useState('');
  const [cxCategory, setCxCategory] = useState('');
  const [cxGenre, setCxGenre] = useState('');
  // E-Hentai/ExHentai (onion + clearnet) and NHentai keep picked tags as
  // chips instead of stuffing them into the search string. The chip cycles
  // on repeated clicks, like the Tags Autocomplete userscript:
  // include → exclude ("!" prefix in state, "-tag" in the query) → remove.
  const [pickedTags, setPickedTags] = useState<string[]>([]);
  const togglePickedTag = (tag: string): void => {
    if (pickedTags.includes(tag)) setPickedTags((prev) => prev.map((t) => (t === tag ? `!${tag}` : t)));
    else if (pickedTags.includes(`!${tag}`)) setPickedTags((prev) => prev.filter((t) => t !== `!${tag}`));
    else setPickedTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  };
  const [mdTagQuery, setMdTagQuery] = useState('');
  const [mdActiveTags, setMdActiveTags] = useState<string[]>([]);
  const [mdLangs, setMdLangs] = useState<string[]>([]);
  const [nhFilterTags, setNhFilterTags] = useState<string[]>([]);
  const [menu, setMenu] = useState<CatalogMenu | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollToTop = (): void => {
    contentRef.current?.scrollTo({ top: 0 });
  };
  const searchIdRef = useRef(0);
  const searchRef = useRef<(p: number, append?: boolean) => Promise<void>>(async () => {});
  const loadingRef = useRef(false);
  const pageRef = useRef(0);
  const sigRef = useRef('');
  const pageCacheRef = useRef<Map<number, CatalogCard[]>>(new Map());
  const infiniteScroll = settings.infinite_scroll;
  const [hasMore, setHasMore] = useState(true);

  const filters: CatalogFilters = {
    ehExcludedCats,
    ehMinRating,
    mangadexTags: mdActiveTags,
    mangadexLangs: mdLangs,
    mangashiSort: msSort,
    mangashiStatus: msStatus,
    mangashiType: msType,
    mangashiYear: msYear,
    mangashiAgeRating: msAge,
    mangashiChaptersMin: msChaptersMin,
    mangashiChaptersMax: msChaptersMax,
    mangashiTags: msTags,
    remangaOrdering: rmOrdering,
    remangaStatus: rmStatus,
    remangaTypes: rmTypes,
    remangaGenres: rmGenres,
    senkuroOrdering: skOrdering,
    senkuroStatuses: skStatus,
    senkuroTypes: skType,
    senkuroFormats: skFormat,
    senkuroRating: skRating,
    comxCategory: cxCategory,
    comxGenre: cxGenre,
    nhentaiTags: nhFilterTags,
  };

  const tagSource = source === 'exhentai' || source === 'exhentai_onion' || source === 'ehentai';
  const nhTagSource = source === 'nhentai' || source === 'nhentai_onion';
  const showFilters =
    source === 'exhentai' ||
    source === 'exhentai_onion' ||
    source === 'ehentai' ||
    source === 'mangashi' ||
    source === 'remanga' ||
    source === 'mangadex' ||
    source === 'senkuro' ||
    source === 'comx' ||
    nhTagSource;
  const visibleSources = settings.show_r34_history ? SOURCES : SOURCES.filter((s) => !R34_SOURCES.includes(s.key));
  const visibleQuickSearches = settings.show_r34_history
    ? settings.quick_searches
    : settings.quick_searches.filter((q) => !R34_SOURCES.includes(q.source));

  useEffect(() => {
    if (tagQuery.trim().length < 2) {
      setEhTags([]);
      setNhTags([]);
      return;
    }
    const t = setTimeout(async () => {
      if (tagSource) setEhTags(await window.api.ehTagSuggest(tagQuery));
      else if (nhTagSource) setNhTags(await window.api.nhentaiTagSuggest(tagQuery));
    }, 300);
    return () => clearTimeout(t);
  }, [tagQuery, tagSource, nhTagSource]);

  useEffect(() => {
    window.api.getExAccounts().then((r) => {
      setExAccounts(r.accounts);
      setExCurrentId(r.currentId);
    });
  }, []);

  // Background page-count enrichment for nhentai cards.
  useEffect(() => {
    return window.api.onNhentaiCounts((entries) => {
      setCards((prev) =>
        prev.map((c) => {
          const e = entries.find((x) => x.url === c.url);
          return e && c.pages == null ? { ...c, pages: e.pages } : c;
        }),
      );
    });
  }, []);

  // Reading-status chips for cards already in the library. Refetched whenever
  // the result set changes and on any library mutation (status set from here,
  // or a change made in the Library screen).
  useEffect(() => {
    let cancelled = false;
    const run = (): void => {
      if (cards.length === 0) {
        setStatuses({});
        return;
      }
      void window.api
        .libraryStatuses(cards.map((c) => c.url))
        .then((m) => {
          if (!cancelled) setStatuses(m);
        })
        .catch(() => {
          /* best-effort */
        });
    };
    run();
    const off = window.api.onLibraryChanged(run);
    return () => {
      cancelled = true;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  // ensure_searched: auto-load the feed on open and whenever the source changes.
  // The previous in-flight search is invalidated: search() bumps searchIdRef and
  // discards any response that arrives after a newer search has started.
  useEffect(() => {
    void search(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const exIsAccountSource = source === 'exhentai' || source === 'ehentai';

  const appendTag = (tag: string): void => {
    setPickedTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    setTagQuery('');
    setEhTags([]);
    setNhTags([]);
  };

  const exSource = source === 'exhentai' || source === 'exhentai_onion' || source === 'ehentai';

  const search = useCallback(
    async (p: number, append = false): Promise<void> => {
      const id = ++searchIdRef.current;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      const effectiveQuery = [query.trim(), ...pickedTags.map((t) => (t.startsWith('!') ? `-${t.slice(1)}` : t))].join(' ').trim();
      // Cache key for the current query/filter/sort combination: a new signature
      // invalidates every prefetched page.
      const sig = `${source}|${effectiveQuery}|${JSON.stringify(filters)}|${sort}`;
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        pageCacheRef.current.clear();
      }
      const cursorFor = (list: CatalogCard[], dir: 'next' | 'prev'): CatalogCursor | undefined => {
        if (exSource) {
          const ref = dir === 'next' ? list[list.length - 1] : list[0];
          const m = ref?.url.match(/\/g\/(\d+)\//);
          if (m) return { dir, cursor: m[1] };
        } else if (source === 'senkuro' && dir === 'next') {
          const last = list[list.length - 1];
          if (last?.cursor) return { dir, cursor: last.cursor };
        }
        return undefined;
      };
      try {
        let res: CatalogCard[];
        const cached = append ? pageCacheRef.current.get(p) : undefined;
        if (cached) {
          pageCacheRef.current.delete(p);
          res = cached;
        } else {
          const dir: 'next' | 'prev' = p < page ? 'prev' : 'next';
          const cursor = p !== 0 ? cursorFor(cards, dir) : undefined;
          res = await window.api.searchCatalog(source, effectiveQuery, p, sort, filters, cursor);
        }
        if (id !== searchIdRef.current) return;
        const prev = cards;
        const seen = new Set(prev.map((x) => x.url));
        const next = append ? [...prev, ...res.filter((c) => !seen.has(c.url))] : res;
        setCards(next);
        setPage(append ? p : 0);
        // Stop infinite scroll once a page returns nothing new (end of list, or a
        // source that ignores the offset). Otherwise `page` keeps growing and the
        // sentinel refetches forever.
        const more = res.length > 0 && (!append || next.length > prev.length);
        setHasMore(more);
        // Prefetch the NEXT page in the background so it appends instantly when the
        // sentinel is reached — seamless, with no visible "Загрузка…" pause.
        if (more && !pageCacheRef.current.has(p + 1)) {
          const nextCursor = cursorFor(next, 'next');
          void window.api
            .searchCatalog(source, effectiveQuery, p + 1, sort, filters, nextCursor)
            .then((cards2) => {
              if (sigRef.current === sig) pageCacheRef.current.set(p + 1, cards2);
            })
            .catch(() => {
              /* prefetch is best-effort */
            });
        }
      } catch (e: any) {
        if (id !== searchIdRef.current) return;
        if (!append) {
          setCards([]);
          setHasMore(false);
        }
        setError(String(e?.message ?? e));
      } finally {
        if (id === searchIdRef.current) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [source, query, pickedTags, sort, filters, exSource, page, cards],
  );

  // Keep the latest search/fn state in refs so the sentinel observer is stable
  // (it must not be recreated on every render — see the effect below).
  searchRef.current = search;
  loadingRef.current = loading;
  pageRef.current = page;

  // Reset scroll page when filters change
  const changeSource = (s: string): void => {
    searchIdRef.current++;
    setSource(s);
    setCards([]);
    setError(null);
    setPage(0);
    setHasMore(true);
    setPickedTags([]);
    scrollToTop();
    // Remember the source for later visits to this screen
    setSettings({ ...settings, last_catalog_source: s });
  };

  // Turning the R34 privacy toggle off while an R34 source is active falls back
  // to a safe source (also hides its now-excluded cards/search presets).
  useEffect(() => {
    if (!settings.show_r34_history && R34_SOURCES.includes(source)) changeSource('mangadex');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.show_r34_history]);

  const resetFilters = (): void => {
    setEhExcludedCats(0);
    setEhMinRating(0);
    setMdActiveTags([]);
    setMdLangs([]);
    setNhFilterTags([]);
    setMsSort('');
    setMsStatus('');
    setMsType('');
    setMsYear('');
    setMsAge('');
    setMsChaptersMin('');
    setMsChaptersMax('');
    setMsTags([]);
    setRmOrdering('');
    setRmStatus('');
    setRmTypes('');
    setRmGenres([]);
    setSkOrdering('');
    setSkStatus([]);
    setSkType([]);
    setSkFormat([]);
    setSkRating('');
    setCxCategory('');
    setCxGenre('');
  };

  // Auto-apply: whenever filters/sort (or their text fields) change, re-run
  // the search from page 0 after a short debounce — no explicit «Найти» or
  // blur needed. A stable signature keeps this from firing on plain renders.
  const filterSig = JSON.stringify(filters) + `|${sort}|${pickedTags.join(' ')}`;
  const firstFilterRun = useRef(true);
  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      return;
    }
    scrollToTop();
    const t = setTimeout(() => {
      void search(0);
    }, 450);
    return () => clearTimeout(t);
    // search is recreated with the fresh filters on each render — the timer
    // always resolves against the newest state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSig, sort]);

  // Quick-search preset launch for the SAME source: [source] won't change, so
  // the auto-search effect above never fires. A sequence bump re-renders with a
  // fresh `search` closure carrying the new query.
  const firstQuickRun = useRef(true);
  useEffect(() => {
    if (firstQuickRun.current) {
      firstQuickRun.current = false;
      return;
    }
    scrollToTop();
    void search(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickSearchSeq]);

  // Infinite scroll sentinel. Deps are intentionally minimal: the observer is
  // recreated only when the card count grows (to keep filling the viewport),
  // when infinite scroll is toggled, or when the list ends — NOT on every render
  // or on each loading toggle (that caused duplicate and runaway page requests).
  useEffect(() => {
    if (!infiniteScroll || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current) {
          void searchRef.current(pageRef.current + 1, true);
        }
      },
      { rootMargin: '400px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [infiniteScroll, cards.length, hasMore]);

  const openChapters = useCallback(async (card: CatalogCard): Promise<void> => {
    setPicked(card);
    setChapters(null);
    setChapterError(null);
    try {
      setChapters(await window.api.fetchChapterList(card.url));
    } catch (e: any) {
      setChapterError(String(e?.message ?? e));
    }
  }, []);

  const onSelectCard = useCallback(
    (c: CatalogCard): void => {
      void openChapters(c);
    },
    [openChapters],
  );

  const openChapter = async (chapterId: string, chapterIndex: number): Promise<void> => {
    const mangaId = picked?.url ?? null;
    const coverUrl = picked?.coverUrl ?? null;
    setOpening(true);
    const r = await window.api.openUrl(chapterId, 0, mangaId, coverUrl, picked?.kind ?? null);
    setOpening(false);
    if (r) {
      if (source === 'mangadex' && mangaId && chapters) {
        const total = chapters.length;
        const progress = { ...settings.read_progress, [mangaId]: [chapterIndex + 1, total] as [number, number] };
        setSettings({ ...settings, read_progress: progress });
      }
      setOpened({ kind: 'online', ...r, startPage: 0, coverUrl, chapterList: chapters, chapterIndex });
      setPicked(null);
      setScreen('Reader');
    }
  };

  const toggleCat = (bit: number): void => {
    setEhExcludedCats((c) => c ^ bit);
  };

  const openCardMenu = useCallback(async (e: React.MouseEvent, card: CatalogCard) => {
    e.preventDefault();
    const lookup = await window.api.libraryLookup(card.url, card.url);
    setMenu({ x: e.clientX, y: e.clientY, card, lookup });
  }, []);

  const setExAccount = (id: number): void => {
    void window.api.setExAccount(id).then((r) => {
      setExAccounts(r.accounts);
      setExCurrentId(r.currentId);
    });
  };

  const entryOf = (
    card: CatalogCard,
  ): { url: string; title: string; coverUrl: string | null; source: string; seriesId: string; kind: string | null } => ({
    url: card.url,
    title: card.title,
    coverUrl: card.coverUrl,
    source: SOURCES.find((s) => s.key === source)?.label ?? '',
    seriesId: card.url,
    kind: card.kind ?? null,
  });

  const menuItems = (m: NonNullable<typeof menu>): MenuItem[] =>
    buildLibraryMenuItems(entryOf(m.card), {
      key: m.lookup?.key ?? null,
      favorited: !!m.lookup?.favorited,
      status: m.lookup?.status ?? null,
    });

  return {
    settings,
    setSettings,
    source,
    changeSource,
    visibleSources,
    exIsAccountSource,
    exAccounts,
    exCurrentId,
    setExAccount,
    exNotice,
    setExNotice,
    query,
    setQuery,
    sort,
    setSort,
    search,
    qsOpen,
    setQsOpen,
    visibleQuickSearches,
    setQuickSearchSeq,
    tagSource,
    nhTagSource,
    tagQuery,
    setTagQuery,
    ehTags,
    nhTags,
    appendTag,
    pickedTags,
    togglePickedTag,
    setPickedTags,
    error,
    loading,
    cards,
    statuses,
    onSelectCard,
    openCardMenu,
    infiniteScroll,
    sentinelRef,
    contentRef,
    page,
    hasMore,
    showFilters,
    resetFilters,
    ehExcludedCats,
    setEhExcludedCats,
    toggleCat,
    ehMinRating,
    setEhMinRating,
    mdTagQuery,
    setMdTagQuery,
    mdActiveTags,
    setMdActiveTags,
    mdLangs,
    setMdLangs,
    nhFilterTags,
    setNhFilterTags,
    msSort,
    setMsSort,
    msStatus,
    setMsStatus,
    msType,
    setMsType,
    msYear,
    setMsYear,
    msAge,
    setMsAge,
    msChaptersMin,
    setMsChaptersMin,
    msChaptersMax,
    setMsChaptersMax,
    msTags,
    setMsTags,
    rmOrdering,
    setRmOrdering,
    rmStatus,
    setRmStatus,
    rmTypes,
    setRmTypes,
    rmGenres,
    setRmGenres,
    skOrdering,
    setSkOrdering,
    skStatus,
    setSkStatus,
    skType,
    setSkType,
    skFormat,
    setSkFormat,
    skRating,
    setSkRating,
    cxCategory,
    setCxCategory,
    cxGenre,
    setCxGenre,
    picked,
    setPicked,
    chapters,
    chapterError,
    opening,
    openChapter,
    menu,
    setMenu,
    menuItems,
  };
}

export type CatalogSearch = ReturnType<typeof useCatalogSearch>;
