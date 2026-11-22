import { errorText } from '../../lib/errors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogCard, CatalogCursor, CatalogFilters, ChapterListItem, ExAccount } from '@shared/ipc';
import { filterCardsByEhKinds } from '@shared/filters';
import type { ReadingStatus } from '@shared/library';
import type { MenuItem } from '../../components/ContextMenu';
import { buildLibraryMenuItems } from '../../lib/library-menu';
import { useStore } from '../../state/store';
import { R34_SOURCES, SOURCES } from './constants';
import { shouldAutoLoad } from './auto-load';
import { trimCursorCache, trimPageCache } from './catalog-cache';

interface CatalogMenu {
  x: number;
  y: number;
  card: CatalogCard;
  lookup: { key: string; favorited: boolean; status: ReadingStatus | null } | null;
}

/** Last rendered catalog page, kept for an instant first paint after launch. */
const CATALOG_CACHE_KEY = 'catalog.last.v1';
/** Per-URL adult flags (Manga-shi), so badges are instant on later launches. */
const ADULT_CACHE_KEY = 'catalog.adult.v1';

function loadAdultCache(): Map<string, boolean> {
  try {
    const raw = localStorage.getItem(ADULT_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    return new Map(Object.entries(parsed).slice(-800));
  } catch {
    return new Map();
  }
}

function saveAdultCache(cache: Map<string, boolean>): void {
  try {
    const entries = [...cache.entries()].slice(-800);
    localStorage.setItem(ADULT_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* quota — cache is optional */
  }
}

export function useCatalogSearch() {  const { setScreen, setOpened, settings, setSettings, settingsReady } = useStore();
  const [source, setSource] = useState(() => {
    const s = settings.last_catalog_source || 'mangadex';
    return !settings.show_r34_history && R34_SOURCES.includes(s) ? 'mangadex' : s;
  });

  // Senkuro exposes ~1100 labels; fetch the dictionary once per session (it is
  // cached for 12 h in the main process) so the filter panel can offer names.
  useEffect(() => {
    if (source !== 'senkuro' || skLabelsRequested.current) return;
    skLabelsRequested.current = true;
    void window.api
      .senkuroLabels()
      .then((list) => setSkLabelList(list))
      .catch(() => {
        skLabelsRequested.current = false;
      });
  }, [source]);
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
  const [ehWatchedOnly, setEhWatchedOnly] = useState(false);
  const [ehToplist, setEhToplist] = useState(0);
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
  const [skRatings, setSkRatings] = useState<string[]>([]);
  const [skSources, setSkSources] = useState<string[]>([]);
  const [skTranslation, setSkTranslation] = useState<string[]>([]);
  const [skCountries, setSkCountries] = useState<string[]>([]);
  const [skLabels, setSkLabels] = useState<string[]>([]);
  const [skChaptersFrom, setSkChaptersFrom] = useState(0);
  const [skChaptersTo, setSkChaptersTo] = useState(0);
  const [skYearFrom, setSkYearFrom] = useState(0);
  const [skYearTo, setSkYearTo] = useState(0);
  /** Label dictionary for the Senkuro filter panel (fetched once). */
  const [skLabelList, setSkLabelList] = useState<{ slug: string; name: string }[]>([]);
  const skLabelsRequested = useRef(false);
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
  /** Separate sequence for chapter-list requests (see openChapters). */
  const chaptersSeqRef = useRef(0);
  /** Signature of the last SUCCESSFUL non-append search (dedupe of double triggers). */
  const completedSigRef = useRef('');
  /** Cursor actually used to fetch each page, keyed `<sig>|<page>`: Senkuro has
   * forward-only cursors, so "Пред." needs the cursor of the target page. */
  const pageCursorRef = useRef(new Map<string, CatalogCursor | undefined>());
  const searchRef = useRef<(p: number, append?: boolean) => Promise<void>>(async () => {});
  const loadingRef = useRef(false);
  const pageRef = useRef(0);
  const sigRef = useRef('');
  /** Page cache per query signature (source|query|filters|sort), LRU-bounded:
   * toggling a category back and forth used to re-hit the network every time,
   * which is seconds over Tor/onion. Now the previous result set is instant. */
  const sigPagesRef = useRef<Map<string, Map<number, CatalogCard[]>>>(new Map());
  const pagesForSig = (sig: string): Map<number, CatalogCard[]> => {
    let m = sigPagesRef.current.get(sig);
    if (m) {
      // refresh LRU position
      sigPagesRef.current.delete(sig);
    } else {
      m = new Map<number, CatalogCard[]>();
      while (sigPagesRef.current.size >= 8) {
        const oldest = sigPagesRef.current.keys().next().value;
        if (oldest === undefined) break;
        sigPagesRef.current.delete(oldest);
      }
    }
    sigPagesRef.current.set(sig, m);
    trimPageCache(m);
    return m;
  };
  const infiniteScroll = settings.infinite_scroll;
  const [hasMore, setHasMore] = useState(true);

  const filters: CatalogFilters = {
    ehExcludedCats,
    ehMinRating,
    ehWatchedOnly,
    ehToplist,
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
    senkuroRatings: skRatings,
    senkuroSources: skSources,
    senkuroTranslation: skTranslation,
    senkuroCountries: skCountries,
    senkuroLabels: skLabels,
    senkuroChaptersFrom: skChaptersFrom || undefined,
    senkuroChaptersTo: skChaptersTo || undefined,
    senkuroYearFrom: skYearFrom || undefined,
    senkuroYearTo: skYearTo || undefined,
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
  // The last rendered list is restored from localStorage first, so the first
  // paint after a launch is instant instead of a spinner + Tor round-trip.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CATALOG_CACHE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { source?: string; cards?: CatalogCard[]; ts?: number };
        const fresh = typeof saved.ts === 'number' && Date.now() - saved.ts < 7 * 24 * 3600_000;
        if (saved.source === source && fresh && Array.isArray(saved.cards) && saved.cards.length > 0) {
          setCards(saved.cards);
        }
      }
    } catch {
      /* corrupt cache — ignore */
    }
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

  // Instant local filtering: the network round-trip through Tor/onion takes
  // seconds, so the already-loaded list is filtered by category immediately and
  // the authoritative result replaces it when it arrives.
  const displayCards = useMemo(() => {
    const base = exSource ? filterCardsByEhKinds(cards, ehExcludedCats) : cards;
    // R34 rule: an 18+ work from ANY source (Senkuro explicit, MangaDex
    // erotica, Remanga forbidden, Manga-shi tags) must stay hidden while the
    // privacy toggle is off, not just R34 sources as a whole.
    return settings.show_r34_history ? base : base.filter((c) => !c.adult);
  }, [cards, exSource, ehExcludedCats, settings.show_r34_history]);
  // Auto-scroll must not keep fetching pages that local filters hide (18+ with
  // R34 off, excluded EH categories): the visible list stays empty, the
  // "near bottom" test is always true, and the catalog used to download page
  // after page of invisible results through Tor.
  const displayCardsRef = useRef(displayCards);
  displayCardsRef.current = displayCards;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  /** Manga-shi's own "18+" cover badge is an age rating it also assigns for
   * violence-only titles, so it is not a reliable erotica signal. Resolve the
   * flag from the title's tags instead (one lazy request per card, cached). */
  const adultTagCache = useRef<Map<string, boolean>>(loadAdultCache());
  const enrichMangashiAdults = useCallback(async (list: CatalogCard[]): Promise<void> => {
    const pending = list.filter((c) => !adultTagCache.current.has(c.url));
    if (pending.length > 0) {
      try {
        const resolved = await window.api.catalogAdultBatch(pending.map((c) => c.url));
        for (const [url, adult] of Object.entries(resolved)) adultTagCache.current.set(url, adult);
        saveAdultCache(adultTagCache.current);
      } catch {
        /* leave unresolved — the next cards update retries */
      }
    }
    // Apply even when nothing was pending: a fresh page/prefetch replaces the
    // card objects, and those copies need the cached flag re-applied. Return the
    // previous array when nothing changed — a new array identity would re-trigger
    // the effect below and spin the renderer (black window).
    setCards((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        const adult = adultTagCache.current.get(c.url);
        if (adult === undefined || c.adult === adult) return c;
        changed = true;
        return { ...c, adult };
      });
      return changed ? next : prev;
    });
  }, []);

  // Run the enrichment whenever a Manga-shi page lands (search, append, prefetch
  // replacement). Doing it in an effect keeps it independent of which code path
  // produced the cards.
  useEffect(() => {
    if (source !== 'mangashi' || cards.length === 0) return;
    void enrichMangashiAdults(cards);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, source]);

  const search = useCallback(
    async (p: number, append = false, force = false): Promise<void> => {
      const effectiveQuery = [query.trim(), ...pickedTags.map((t) => (t.startsWith('!') ? `-${t.slice(1)}` : t))].join(' ').trim();
      // Cache key for the current query/filter/sort combination: a new signature
      // invalidates every prefetched page.
      const sig = `${source}|${effectiveQuery}|${JSON.stringify(filters)}|${sort}`;
      // Two effects can fire for one user action (source switch + tag/filters
      // debounce, quick-search apply): the first result was thrown away by the
      // request-id guard, i.e. a wasted Tor round-trip. An explicit "Найти"
      // passes force.
      if (!force && !append && sig === completedSigRef.current && cards.length > 0) return;
      const id = ++searchIdRef.current;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      sigRef.current = sig;
      const pages = pagesForSig(sig);
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
        // A prefetched page is usable in pager mode too; reading it only when
        // appending made the prefetch dead weight (every page loaded twice).
        const cached = pages.get(p);
        if (cached) {
          pages.delete(p);
          res = cached;
        } else {
          const dir: 'next' | 'prev' = p < page ? 'prev' : 'next';
          // Senkuro has forward-only cursors: going back needs the cursor that
          // was used to load that page, otherwise "Пред." fetched page 1.
          const stored = pageCursorRef.current.get(`${sig}|${p}`);
          const cursor = p === 0 ? undefined : dir === 'prev' ? (stored ?? cursorFor(cards, 'prev')) : (cursorFor(cards, 'next') ?? stored);
          res = await window.api.searchCatalog(source, effectiveQuery, p, sort, filters, cursor);
          pageCursorRef.current.set(`${sig}|${p}`, cursor);
          trimCursorCache(pageCursorRef.current);
        }
        if (id !== searchIdRef.current) return;
        const prev = cards;
        const seen = new Set(prev.map((x) => x.url));
        const next = append ? [...prev, ...res.filter((c) => !seen.has(c.url))] : res;
        setCards(next);
        completedSigRef.current = sig;
        if (!append && res.length > 0) {
          try {
            localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ source, cards: next.slice(0, 60), ts: Date.now() }));
          } catch {
            /* quota — cache is optional */
          }
        }
        setPage(p);
        // Stop infinite scroll once a page returns nothing new (end of list, or a
        // source that ignores the offset). Otherwise `page` keeps growing and the
        // sentinel refetches forever.
        const more = res.length > 0 && (!append || next.length > prev.length);
        setHasMore(more);
        // Prefetch the NEXT page in the background so it appends instantly when the
        // sentinel is reached — seamless, with no visible "Загрузка…" pause.
        // ExHentai family: NO prefetch. The site bans an IP for "excessive
        // request rate", and the prefetch doubled the number of listing requests
        // (through a shared Tor exit that trips the ban fast). Pages load on
        // demand there instead, and the main process paces those requests.
        if (more && !exSource && !pages.has(p + 1)) {
          const nextCursor = cursorFor(next, 'next');
          void window.api
            .searchCatalog(source, effectiveQuery, p + 1, sort, filters, nextCursor)
            .then((cards2) => {
              if (sigRef.current !== sig) return;
              pages.set(p + 1, cards2);
              trimPageCache(pages);
              pageCursorRef.current.set(`${sig}|${p + 1}`, nextCursor);
            })
            .catch(() => {
              /* prefetch is best-effort */
            });
        }
      } catch (e: any) {
        if (id !== searchIdRef.current) return;
        if (!append) {
          // A page past the end usually throws "Ничего не найдено"; wiping the
          // cards in pager mode hid the pager itself, so the user was stuck on
          // an empty screen with no way back. Only page 0 may clear the grid.
          if (p === 0) setCards([]);
          setHasMore(false);
        }
        setError(errorText(e));
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
    completedSigRef.current = '';
    pageCursorRef.current.clear();
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

  // Restore the source the user was last on. `useState` above runs on the very
  // first render, when the store still holds defaultSettings() (the real file
  // arrives asynchronously), so reading it there always yielded 'mangadex'.
  const sourceHydrated = useRef(false);
  useEffect(() => {
    if (!settingsReady || sourceHydrated.current) return;
    sourceHydrated.current = true;
    const saved = settings.last_catalog_source;
    if (!saved || saved === source) return;
    if (!settings.show_r34_history && R34_SOURCES.includes(saved)) return;
    setSource(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady, settings.last_catalog_source, settings.show_r34_history]);

  const resetFilters = (): void => {
    setEhExcludedCats(0);
    setEhMinRating(0);
    setEhWatchedOnly(false);
    setEhToplist(0);
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
    setSkRatings([]);
    setSkSources([]);
    setSkTranslation([]);
    setSkCountries([]);
    setSkLabels([]);
    setSkChaptersFrom(0);
    setSkChaptersTo(0);
    setSkYearFrom(0);
    setSkYearTo(0);
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
    }, 300);
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

  // Infinite scroll: load the next page when the scroll container approaches
  // its bottom. This used to rely solely on an IntersectionObserver whose root
  // was the viewport — but the sentinel lives inside a scrollable container, so
  // the observer only fired on a clean visibility TRANSITION. If that transition
  // happened while a request was in flight (the callback is then ignored), the
  // list stalled forever: no new pages, no error, no pager. A scroll listener +
  // a post-render re-check is deterministic and also covers content that does
  // not fill the viewport yet.
  const errorRef = useRef<string | null>(null);
  errorRef.current = error;
  useEffect(() => {
    if (!infiniteScroll || !hasMore) return;
    const c = contentRef.current;
    if (!c) return;
    let raf = 0;
    const maybeLoad = (): void => {
      raf = 0;
      // While an error is on screen, do not hammer the source automatically:
      // the user gets an explicit «Повторить» button instead.
      if (loadingRef.current || errorRef.current) return;
      // Hidden catalog (another screen is open) has zero sizes → the old
      // near-bottom test was always true and fetched pages in the background.
      if (!shouldAutoLoad(c)) return;
      // Cards are loaded but every one is hidden by a local filter: loading
      // further pages only adds invisible results (and Tor traffic).
      if (displayCardsRef.current.length === 0 && cardsRef.current.length > 0) return;
      void searchRef.current(pageRef.current + 1, true);
    };
    const onScroll = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(maybeLoad);
    };
    c.addEventListener('scroll', onScroll, { passive: true });
    // After every page lands the container grows; if it still ends above the
    // threshold (short page, tall window) keep filling. This also retries a
    // load that was skipped while the previous request was in flight. The slow
    // interval covers the case where a transient failure left the content
    // SHORTER than the viewport: there is nothing to scroll, so a scroll-based
    // trigger alone could never fire again.
    const t = setTimeout(maybeLoad, 300);
    const iv = setInterval(maybeLoad, 2500);
    return () => {
      c.removeEventListener('scroll', onScroll);
      clearTimeout(t);
      clearInterval(iv);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [infiniteScroll, hasMore, cards.length]);

  const openChapters = useCallback(async (card: CatalogCard): Promise<void> => {
    // Guard against out-of-order responses: opening card A, closing it and then
    // opening B let A's chapter list land under B's header (and `openChapter`
    // then opened the wrong work / wrote progress for the wrong chapters).
    const seq = ++chaptersSeqRef.current;
    setPicked(card);
    setChapters(null);
    setChapterError(null);
    try {
      const list = await window.api.fetchChapterList(card.url);
      if (seq !== chaptersSeqRef.current) return;
      setChapters(list);
    } catch (e: any) {
      if (seq !== chaptersSeqRef.current) return;
      setChapterError(errorText(e));
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
    setChapterError(null);
    try {
      // The badge enrichment is asynchronous: a card clicked before it finishes
      // has no `adult` yet. Resolve it here so the history/library row still
      // lands in the correct tab.
      let adult = picked?.adult;
      if (adult === undefined && mangaId) {
        try {
          const resolved = await window.api.catalogAdultBatch([mangaId]);
          adult = resolved[mangaId] === true;
        } catch {
          /* keep undefined */
        }
      }
      const r = await window.api.openUrl(chapterId, 0, mangaId, coverUrl, picked?.kind ?? null, chapterIndex, adult === true);
      if (r) {
        if (source === 'mangadex' && mangaId && chapters) {
          const total = chapters.length;
          const progress = { ...settings.read_progress, [mangaId]: [chapterIndex + 1, total] as [number, number] };
          setSettings({ ...settings, read_progress: progress });
        }
        setOpened({ kind: 'online', ...r, startPage: 0, coverUrl, chapterList: chapters, chapterIndex });
        setPicked(null);
        setScreen('Reader');
      } else {
        setChapterError('Не удалось открыть главу: неверный URL или источник не поддерживается');
      }
    } catch (e: any) {
      setChapterError(errorText(e));
    } finally {
      setOpening(false);
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
    displayCards,
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
    filters,
    setEhExcludedCats,
    toggleCat,
    ehMinRating,
    setEhMinRating,
    ehWatchedOnly,
    setEhWatchedOnly,
    ehToplist,
    setEhToplist,
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
    skRatings,
    setSkRatings,
    skSources,
    setSkSources,
    skTranslation,
    setSkTranslation,
    skCountries,
    setSkCountries,
    skLabels,
    setSkLabels,
    skChaptersFrom,
    setSkChaptersFrom,
    skChaptersTo,
    setSkChaptersTo,
    skYearFrom,
    setSkYearFrom,
    skYearTo,
    setSkYearTo,
    skLabelList,
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