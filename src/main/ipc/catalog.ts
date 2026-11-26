import { z } from 'zod';
import { app } from 'electron';
import { lookup as dnsPromiseLookup } from 'dns';
import { CH } from '@shared/ipc';
import { handleSafe, nonNegInt, anyString, stringArray, httpUrl } from './validate';
import type { SettingsService } from '../services/settings';
import type { ExAccountsService } from '../services/accounts';
import type { SimpleSiteConfig } from '../services/sources/catalog-types';
import {
  GROUPLE_SITES,
  searchGrouple,
  fetchGroupleChapters,
  searchMangaShi,
  searchNhentai,
  searchRemanga,
  searchSenkuro,
  searchExHentai,
  fetchMangaShiChapters,
} from '../services/catalog-search';
import { searchMangaDex, fetchChapterCount, fetchChapterList } from '../services/mangadex';
import { fetchRemangaChapters, fetchSenkuroChapters, mangaSeriesUrlFromChapterUrl, senkuroMangaSlugFromUrl } from '../services/sources';
import { enrichNhentaiPageCounts } from '../services/sources/nhentai';
import { logger } from '../services/logger';
import { loadBridgeHealth, bridgeKey } from '../services/tor-bridge-health';
import { fetchSourceTags } from '../services/source-tags';
import { fetchEhPopular, resetEhCooldown, EhRateLimitError, resetEhImageLimit } from '../services/sources/eh';
import { fetchEhTorrents, fetchEhGalleryInfo, fetchEhFavorites, ehHathDownload } from '../services/eh-extras';
import { fetchSenkuroLabels } from '../services/sources/senkuro';
import { catalogSuggest } from '../services/catalog-suggest';
import { probeSocks5Handshake, probeBridgeLine, probeSite, allSiteKeys } from '../services/tor-check';
import { embeddedTorSocks, rotateTorExit } from '../services/tor-embedded';
import { warmTorCircuits } from '../services/http';
import { fetchEhTagSuggest, fetchNhentaiTagSuggestions } from '../services/tags';
import { httpFetch } from '../services/http';
import { LIB_MIRRORS } from '../services/lib-mirror';
import { checkCustomDns } from '../services/custom-dns';
import { groupleCache } from '../app/state';
import { proxyForSource, proxyForUrl } from '../services/proxy-policy';

export interface CatalogDeps {
  settings: SettingsService;
  effectiveTorSocks(): string;
  exAccounts: ExAccountsService;
  whenEmbeddedTorReady(ms: number): Promise<unknown>;
  refreshGroupleCache(source: string): Promise<void>;
  broadcastNhentaiCounts(entries: { url: string; pages: number }[]): void;
  /** Repairs a stored series title when a source reveals the real work name
   * (Senkuro chapter nodes carry only the chapter number: rows were titled "1"). */
  onSeriesTitle?(seriesId: string, title: string): void;
}

export function registerCatalog(deps: CatalogDeps): {
  fetchChapterListFor(mangaId: string): Promise<{ chapter_id: string; chapter_num: string; title: string | null }[]>;
  fetchChapterListSafe(mangaId: string): Promise<{ chapter_id: string; chapter_num: string; title: string | null }[] | null>;
  fetchChapterCountSafe(mangaId: string): Promise<number | null>;
} {
  const { settings, effectiveTorSocks, exAccounts, whenEmbeddedTorReady, refreshGroupleCache, onSeriesTitle } = deps;

  /** Chapter lists are re-requested every time the overlay opens; Senkuro
   * needs 2 + N GraphQL round-trips (259 chapters = 4 requests), so repeat
   * opens felt like a fresh download. Short TTL keeps it fresh enough while
   * making reopen instant. */
  const CHAPTER_CACHE_TTL_MS = 5 * 60_000;
  const CHAPTER_CACHE_MAX = 24;
  const chapterListCache = new Map<string, { at: number; chapters: { chapter_id: string; chapter_num: string; title: string | null }[] }>();

  async function fetchChapterListFor(mangaId: string): Promise<{ chapter_id: string; chapter_num: string; title: string | null }[]> {
    const cached = chapterListCache.get(mangaId);
    if (cached && Date.now() - cached.at < CHAPTER_CACHE_TTL_MS) return cached.chapters;
    // Chapter lists are fetched from the same hosts as the catalog and the
    // reader, so they must follow the same Tor policy (per-source toggle or
    // the always-on Grouple rule) instead of a direct connection.
    const s = settings.get();
    const torSocks = effectiveTorSocks();
    const srcProxy = proxyForUrl(mangaId, s, torSocks);
    let chapters;
    if (mangaId.includes('remanga.org')) {
      // A chapter URL (…/manga/<dir>/<chapter>/) is not a valid series id: the
      // chapters endpoint needs the title URL.
      const seriesUrl = mangaSeriesUrlFromChapterUrl(mangaId) ?? mangaId;
      chapters = await fetchRemangaChapters(seriesUrl, srcProxy);
    } else if (mangaId.includes('senkuro')) {
      // Works for both the manga URL and the chapter URL (…/manga/<slug>/chapter/<id>):
      // the old "last path segment" fallback took the chapter id as the slug.
      const slug = senkuroMangaSlugFromUrl(mangaId) ?? mangaId.trim().replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? mangaId;
      const res = await fetchSenkuroChapters(slug, s.senkuro_cookies_raw, srcProxy);
      chapters = res.chapters;
      // The library row may predate the title fix (stored the chapter number as
      // its title). Repair it now that the real work title is known.
      if (res.mangaTitle) onSeriesTitle?.(mangaId, res.mangaTitle);
    } else if (mangaId.includes('mangalib') || mangaId.includes('hentailib')) {
      const siteId = mangaId.includes('hentailib') ? 2 : 1;
      const { mangalibChapters, mangalibChapterUrl, mangalibChapterSortKey, mangalibChapterTitle } = await import('../services/sources/mangalib');
      const mlProxy = srcProxy;
      // Chapter URLs are …/<id>--<slug>/read/v1/c5: the numeric slug is the series.
      const slug = mangaId.split('/').find((seg) => /^\d+--/.test(seg)) ?? mangaId.trim().replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? mangaId;
      const list = await mangalibChapters(slug, mlProxy, siteId);
      chapters = list
        .sort((a, b) => mangalibChapterSortKey(a) - mangalibChapterSortKey(b))
        .map((c) => ({
          chapter_id: mangalibChapterUrl(slug, c, siteId),
          chapter_num: mangalibChapterTitle(c),
          title: null,
          lang: siteId === 2 ? 'hentailib' : 'mangalib',
        }));
    } else if (mangaId.includes('manga-shi')) {
      chapters = await fetchMangaShiChapters(mangaId, srcProxy);
    } else if (/nhentai/.test(mangaId)) {
      // nhentai galleries have no chapter list: the whole gallery opens as a
      // single "chapter" (chapter_id = gallery URL, resolved by openUrl).
      return [{ chapter_id: mangaId, chapter_num: '1', title: null }];
    } else if (mangaId.includes('readmanga.') || mangaId.includes('mintmanga.') || mangaId.includes('mangapoisk.')) {
      chapters = await fetchGroupleChapters(mangaId, undefined, { proxy: torSocks });
    } else if (mangaId.includes('com-x.life')) {
      const { fetchComxChapters } = await import('../services/sources/comx');
      chapters = await fetchComxChapters(mangaId, srcProxy);
    } else if (mangaId.includes('exhentai') || mangaId.includes('e-hentai.org')) {
      // E-Hentai family galleries have no chapter list: the whole gallery
      // opens as a single "chapter" (chapter_id = gallery URL, resolved by openUrl).
      return [{ chapter_id: mangaId, chapter_num: '1', title: null }];
    } else {
      chapters = await fetchChapterList(mangaId);
    }
    const list = chapters.map((c) => ({ chapter_id: c.chapter_id, chapter_num: c.chapter_num, title: c.title }));
    while (chapterListCache.size >= CHAPTER_CACHE_MAX) {
      const oldest = chapterListCache.keys().next().value;
      if (oldest === undefined) break;
      chapterListCache.delete(oldest);
    }
    chapterListCache.set(mangaId, { at: Date.now(), chapters: list });
    return list;
  }

  async function fetchChapterListSafe(
    mangaId: string,
  ): Promise<{ chapter_id: string; chapter_num: string; title: string | null }[] | null> {
    try {
      return await fetchChapterListFor(mangaId);
    } catch {
      return null;
    }
  }

  async function fetchChapterCountSafe(mangaId: string): Promise<number | null> {
    const list = await fetchChapterListSafe(mangaId);
    return list ? list.length : null;
  }

  handleSafe(CH.fetchChapterList, z.tuple([anyString]), async (_e, mangaId: string) => {
    return await fetchChapterListFor(mangaId);
  });
  handleSafe(CH.catalogTags, z.tuple([httpUrl]), async (_e, url: string) => {
    try {
      return await fetchSourceTags(url, settings.get(), { torSocks: effectiveTorSocks() });
    } catch {
      return [];
    }
  });
  handleSafe(CH.catalogAdultBatch, z.tuple([z.array(httpUrl).max(60)]), async (_e, urls: string[]) => {
    const s = settings.get();
    const torSocks = effectiveTorSocks();
    const out: Record<string, boolean> = {};
    let cursor = 0;
    // 10 concurrent htmx-fragment fetches: a 20-card page resolves in well
    // under a second, so the 18+ badges no longer trickle in visibly.
    const worker = async (): Promise<void> => {
      while (cursor < urls.length) {
        const url = urls[cursor++];
        try {
          const tags = await fetchSourceTags(url, s, { torSocks });
          out[url] = tags.some((t) => /18\+|эротик|хентай|секс/i.test(t));
        } catch {
          out[url] = false;
        }
      }
    };
    await Promise.all(Array.from({ length: 10 }, () => worker()));
    return out;
  });
  handleSafe(
    CH.searchCatalog,
    z.tuple([
      z.string().max(64),
      anyString,
      nonNegInt,
      z.string().max(32),
      z.record(z.string(), z.unknown()).optional(),
      z.object({ dir: z.enum(['next', 'prev']), cursor: z.string().min(1).max(8192) }).nullable().optional(),
    ]),
    async (_e, source: string, query: string, page: number, sort: string, filters: any = {}, cursor: any = null) => {
      const s = settings.get();
      // Onion/proxied sources must wait for the bundled daemon to finish
      // bootstrapping instead of racing straight into the (often shut down)
      // user Tor SOCKS on 9150.
      if (
        s.builtin_tor &&
        !embeddedTorSocks() &&
        (s.tor_proxied_sites.includes(source) || source.endsWith('_onion') || source === 'nhentai_onion')
      ) {
        try {
          await whenEmbeddedTorReady(120_000);
        } catch {
          /* fall through to direct */
        }
      }
      const torSocks = effectiveTorSocks();
      const siteKey = source === 'nhentai_onion' ? 'nhentai' : source;
      const proxy = s.tor_proxied_sites.includes(siteKey) || source.endsWith('_onion') ? torSocks : undefined;

      if (source === 'mangadex') {
        const cards = await searchMangaDex(query, sort as any, page, filters.mangadexTags ?? [], filters.mangadexLangs ?? []);
        // Fetch chapter counts in the background with limited concurrency
        // (mirrors the original app's async card enrichment).
        const enriched: any[] = [];
        let next = 0;
        async function worker(): Promise<void> {
          while (next < cards.length) {
            const i = next++;
            try {
              const count = await fetchChapterCount(cards[i].manga_id);
              enriched[i] = { ...cards[i], chapterCount: count };
            } catch {
              enriched[i] = cards[i];
            }
          }
        }
        await Promise.all(Array.from({ length: 6 }, () => worker()));
        return enriched.map((c) => ({
          url: c.manga_id,
          title: c.title,
          coverUrl: c.cover_url,
          pages: null,
          kind: c.kind,
          score: c.score,
          chapterCount: c.chapterCount ?? null,
          tags: c.tags ?? [],
          adult: c.adult === true,
        }));
      }
      if (source === 'remanga') return await searchRemanga(query, page, filters, proxyForSource('remanga', s, torSocks));
      if (source === 'senkuro') {
        // api.senkuro.me serves the browse catalog anonymously too; cookies
        // (when present) still carry the Authorization bearer token.
        return await searchSenkuro(
          query,
          s.senkuro_cookies_raw,
          cursor?.dir === 'next' ? cursor.cursor : undefined,
          {
            senkuroOrdering: filters.senkuroOrdering,
            senkuroStatuses: filters.senkuroStatuses,
            senkuroTypes: filters.senkuroTypes,
            senkuroFormats: filters.senkuroFormats,
            senkuroRatings: filters.senkuroRatings,
            senkuroSources: filters.senkuroSources,
            senkuroTranslation: filters.senkuroTranslation,
            senkuroCountries: filters.senkuroCountries,
            senkuroLabels: filters.senkuroLabels,
            senkuroChaptersFrom: filters.senkuroChaptersFrom,
            senkuroChaptersTo: filters.senkuroChaptersTo,
            senkuroYearFrom: filters.senkuroYearFrom,
            senkuroYearTo: filters.senkuroYearTo,
          },
          proxyForSource('senkuro', s, torSocks),
        );
      }
      if (source === 'mangashi') return await searchMangaShi(query, proxy, filters, page);
      if (source === 'nhentai' || source === 'nhentai_onion') {
        const isOnion = source === 'nhentai_onion';
        const base = isOnion
          ? s.nhentai_onion_base || 'http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion'
          : 'https://nhentai.net';
        const items = await searchNhentai(base, query, page, {
          proxy: isOnion ? torSocks : proxy,
          cookieHeader: isOnion ? s.nhentai_onion_cookies_raw : s.nhentai_cookies_raw,
          tags: filters.nhentaiTags,
        });
        // Background page-count enrichment so the catalog renders immediately.
        if (!s.nhentai_show_page_counts) return items;
        void (async () => {
          await enrichNhentaiPageCounts(
            items,
            base,
            {
              proxy: isOnion ? torSocks : proxy,
              cookieHeader: isOnion ? s.nhentai_onion_cookies_raw : s.nhentai_cookies_raw,
            },
            (url, pages) => {
              deps.broadcastNhentaiCounts([{ url, pages }]);
            },
          );
        })().catch(() => {});
        return items.map((c) => ({ ...c, adult: true }));
      }
      if (source === 'ehentai' || source === 'exhentai' || source === 'exhentai_onion') {
        const useOnion = source === 'exhentai_onion';
        const cookieHeader = useOnion ? s.onion_cookies_raw : exAccounts.currentCookieHeader();
        // The "E-Hentai" Tor toggle routes both e-hentai.org and exhentai.org
        // through Tor (same site family), like the original app.
        const torForEx = s.tor_proxied_sites.includes('ehentai') || s.tor_proxied_sites.includes('exhentai');
        const useTor = useOnion || torForEx;
        const exProxy = useTor ? torSocks : s.exhentai_proxy_addr.trim() || undefined;
        const t0 = Date.now();
        const runSearch = (cookie: string) =>
          searchExHentai(
            query,
            {
              cookieHeader: cookie,
              torSocksAddr: torSocks,
              useOnion,
              page,
              forceTor: torForEx,
              excludedCats: filters.ehExcludedCats,
              minRating: filters.ehMinRating,
              watchedOnly: filters.ehWatchedOnly === true,
              toplist: filters.ehToplist && filters.ehToplist > 0 ? filters.ehToplist : undefined,
              domainOverride: source === 'ehentai' ? 'https://e-hentai.org' : undefined,
              cursor: cursor ? { dir: cursor.dir, gid: cursor.cursor } : undefined,
            },
            exProxy,
          );
        let ex;
        try {
          ex = await runSearch(cookieHeader);
        } catch (e) {
          // A stale `igneous` makes ExHentai answer an EMPTY 200 page (the
          // account cookie itself is still valid). Refreshing igneous from the
          // member cookies fixes it without asking the user to log in again.
          if ((e as any)?.ehEmpty && !useOnion) {
            const r = await exAccounts.refreshIgneous().catch(() => null);
            if (r?.ok) {
              resetEhCooldown();
              logger.info('[eh] empty page — igneous refreshed, retrying');
              ex = await runSearch(exAccounts.currentCookieHeader());
            } else {
              throw e;
            }
          } else {
            // Clearnet ExHentai: an account can be rate-limited by itself. If the
            // pool has another account, switch and retry once instead of making the
            // user wait out the ban. (Onion sessions cannot be swapped like this —
            // they need a fresh login — and eh.ts already says so in its error.)
            const canSwitch = !useOnion && e instanceof EhRateLimitError && exAccounts.accounts.length > 1;
            if (!canSwitch) throw e;
            const next = exAccounts.rotate();
            if (!next) throw e;
            logger.info('[eh] account rate limited — switched to account', next.name);
            resetEhCooldown();
            ex = await runSearch(exAccounts.currentCookieHeader());
          }
        }
        logger.info(
          '[catalog-timing]',
          source,
          'page=',
          page,
          'cats=',
          filters.ehExcludedCats ?? 0,
          'rating=',
          filters.ehMinRating ?? 0,
          'took=',
          Date.now() - t0,
          'ms cards=',
          ex.length,
        );
        return ex.map((c) => ({
          url: c.url,
          title: c.title,
          coverUrl: c.coverUrl,
          pages: c.pages,
          score: c.rating,
          kind: c.category,
          tags: c.tags ?? [],
          // Every E-Hentai/ExHentai gallery is adult content; without this
          // flag the privacy blur was bypassed for the whole R34 source.
          adult: true,
        }));
      }
      if (source === 'comx') {
        const { searchComx } = await import('../services/sources/comx');
        const { COMX_BASE } = await import('../services/sources/comx');
        return await searchComx(
          { name: 'Com-X', base: COMX_BASE, catalogPath: '/comix-read/', searchPath: '/search/', linkMarker: '.html' },
          query,
          page,
          {
            proxy,
            category: filters.comxCategory,
            genre: filters.comxGenre,
            genres: filters.comxGenres,
            excludeGenres: filters.comxExcludeGenres,
            types: filters.comxTypes,
            statuses: filters.comxStatuses,
            ages: filters.comxAges,
            yearFrom: filters.comxYearFrom,
            yearTo: filters.comxYearTo,
            hideMine: filters.comxHideMine,
          },
        );
      }
      if (source === 'mangalib' || source === 'hentailib') {
        const { searchMangalib } = await import('../services/sources/mangalib');
        const mlProxy = s.tor_proxied_sites.includes('mangalib') ? torSocks : s.mangalib_proxy_addr.trim() || undefined;
        return await searchMangalib(query, page, mlProxy, filters, source === 'hentailib' ? 2 : 1);
      }
      const groupleIdx = { readmanga: 0, mintmanga: 1, mangapoisk: 2 } as const;
      if (source in groupleIdx) {
        const cfg = GROUPLE_SITES[groupleIdx[source as keyof typeof groupleIdx]] as SimpleSiteConfig;
        // The cache holds page 0 of the default listing only: serving it for
        // page 1..N made the pager show the same 50 titles forever (and the
        // infinite-scroll sentinel saw no new cards, so Grouple pagination was
        // completely dead).
        const groupleFiltersActive =
          source === 'mangapoisk'
            ? !!(filters.mangapoiskGenres?.length ||
                filters.mangapoiskYears?.length ||
                filters.mangapoiskStatus ||
                (filters.mangapoiskSortBy && filters.mangapoiskSortBy !== 'popular'))
            : !!(filters.readmangaSortType ||
                filters.readmangaProductionStatuses?.length ||
                filters.readmangaTranslationStatuses?.length ||
                filters.readmangaGenres?.length ||
                filters.readmangaCategories?.length ||
                filters.readmangaLimitations?.length ||
                filters.readmangaAnother?.length ||
                filters.readmangaSearchFilters?.length ||
                filters.readmangaExcludeGenres?.length ||
                filters.readmangaExcludeCategories?.length ||
                filters.readmangaYearMin ||
                filters.readmangaYearMax);
        const cached = page === 0 && !groupleFiltersActive ? groupleCache.get(source) : undefined;
        if (!query.trim() && page === 0 && !groupleFiltersActive && cached && cached.base === cfg.base && Date.now() - cached.ts < 10 * 60_000) {
          // Refresh in the background so the next visit is still fresh.
          void refreshGroupleCache(source);
          return cached.items;
        }
        // Grouple hosts are TCP/SNI-blocked on most RU networks — always go
        // through Tor (direct attempts just burn 10-30 s of timeouts).
        const readmangaFilters = source === 'readmanga' || source === 'mintmanga'
          ? {
              sortType: filters.readmangaSortType,
              productionStatuses: filters.readmangaProductionStatuses,
              translationStatuses: filters.readmangaTranslationStatuses,
              elementIds: [
                ...(filters.readmangaGenres ?? []),
                ...(filters.readmangaCategories ?? []),
                ...(filters.readmangaLimitations ?? []),
                ...(filters.readmangaAnother ?? []),
              ],
              excludeElementIds: [...(filters.readmangaExcludeGenres ?? []), ...(filters.readmangaExcludeCategories ?? [])],
              searchFilters: filters.readmangaSearchFilters,
              yearMin: filters.readmangaYearMin,
              yearMax: filters.readmangaYearMax,
            }
          : undefined;
        const groupleFilters = source === 'mangapoisk'
          ? {
              genres: filters.mangapoiskGenres,
              years: filters.mangapoiskYears,
              status: filters.mangapoiskStatus,
              sortBy: filters.mangapoiskSortBy,
            }
          : readmangaFilters;
        const items = await searchGrouple(cfg, query, page, undefined, { proxy: torSocks, filters: groupleFilters });
        if (!query.trim() && page === 0 && !groupleFiltersActive) groupleCache.set(source, { base: cfg.base || '', items, ts: Date.now() });
        return items;
      }
      return [];
    },
  );
  handleSafe(
    CH.catalogPopular,
    z.tuple([z.enum(['ehentai', 'exhentai', 'exhentai_onion'])]),
    async (_e, source: 'ehentai' | 'exhentai' | 'exhentai_onion') => {
      const s = settings.get();
      const useOnion = source === 'exhentai_onion';
      const torProxied = useOnion || s.tor_proxied_sites.includes('ehentai') || s.tor_proxied_sites.includes('exhentai');
      if (s.builtin_tor && !embeddedTorSocks() && torProxied) {
        try {
          await whenEmbeddedTorReady(120_000);
        } catch {
          /* fall through */
        }
      }
      const torSocks = effectiveTorSocks();
      const cookieHeader = useOnion ? s.onion_cookies_raw : exAccounts.currentCookieHeader();
      const ex = await fetchEhPopular(source, {
        cookieHeader,
        torSocksAddr: torSocks,
        exProxyAddr: s.exhentai_proxy_addr,
        torProxied,
      });
      return ex.map((c) => ({ url: c.url, title: c.title, coverUrl: c.coverUrl, pages: c.pages, score: c.rating, kind: c.category, adult: true }));
    },
  );
  handleSafe(CH.ehTagSuggest, z.tuple([anyString]), async (_e, text: string) => {
    const s = settings.get();
    const proxy = s.tor_proxied_sites.includes('ehentai') ? effectiveTorSocks() : s.exhentai_proxy_addr.trim() || undefined;
    return await fetchEhTagSuggest(text, { proxy, cookieHeader: exAccounts.currentCookieHeader() || s.onion_cookies_raw });
  });
  handleSafe(CH.catalogSuggest, z.tuple([z.string().max(40), anyString]), async (_e, source: string, query: string) => {
    const s = settings.get();
    const torSocks = effectiveTorSocks();
    const nhentaiOnion = source === 'nhentai_onion';
    const ehOnion = source === 'exhentai_onion';
    return await catalogSuggest(source, query, {
      senkuroCookie: s.senkuro_cookies_raw,
      senkuroProxy: proxyForSource('senkuro', s, torSocks),
      remangaProxy: proxyForSource('remanga', s, torSocks),
      ehCookie: ehOnion ? s.onion_cookies_raw : exAccounts.currentCookieHeader(),
      ehProxy: proxyForSource(ehOnion ? 'exhentai' : source === 'ehentai' ? 'ehentai' : 'exhentai', s, torSocks),
      nhentaiBase: nhentaiOnion
        ? s.nhentai_onion_base || 'http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion'
        : 'https://nhentai.net',
      nhentaiCookie: nhentaiOnion ? s.nhentai_onion_cookies_raw : s.nhentai_cookies_raw,
      nhentaiProxy: nhentaiOnion ? torSocks : proxyForSource('nhentai', s, torSocks),
    });
  });
  handleSafe(CH.nhentaiTagSuggest, z.tuple([anyString]), async (_e, text: string) => {
    const s = settings.get();
    const proxy = s.tor_proxied_sites.includes('nhentai') ? effectiveTorSocks() : undefined;
    return await fetchNhentaiTagSuggestions(text, { proxy });
  });
  handleSafe(CH.checkTor, z.tuple([]), async () => {
    const s = settings.get();
    // Wait for the bundled daemon to bootstrap before probing the address:
    // effectiveTorSocks() still points at the configured (usually Tor Browser)
    // address until then, so the check reported "Tor недоступен" a few seconds
    // after launch even though the daemon was coming up.
    if (s.builtin_tor && !embeddedTorSocks()) {
      try {
        await whenEmbeddedTorReady(60_000);
      } catch {
        /* probe the configured address and report the real error */
      }
    }
    return await probeSocks5Handshake(effectiveTorSocks());
  });
  handleSafe(CH.checkBridges, z.tuple([stringArray]), async (_e, lines: string[]) => {
    const health = loadBridgeHealth(app.getPath('userData'));
    const probed = await Promise.all(lines.map((line) => probeBridgeLine(line)));
    return probed.map((b) => ({ ...b, lastBootstrap: health[bridgeKey(b.line)] ?? null }));
  });
  handleSafe(CH.newTorCircuit, z.tuple([]), async () => {
    // Full rotation: NEWNYM plus blacklisting the current exit, because NEWNYM
    // alone often reuses the same relay (and its ban) for the same destination.
    const r = await rotateTorExit();
    warmTorCircuits(effectiveTorSocks(), ['e-hentai.org', 'exhentai.org', 'ehgt.org']);
    // The old ban belonged to the previous exit IP: drop the cooldown so the
    // user's next request is actually sent instead of failing for another
    // 10 minutes.
    if (r.changed) resetEhCooldown();
    return { ok: r.changed };
  });
  /** Route/cookies for EH "extra" pages (torrents, details, favorites, H@H).
   * The onion mirror only serves galleries/comments; torrents/archiver/home are
   * clearnet-only, so those requests must NOT carry the onion session cookie to
   * a clearnet host (the site answers a redirect instead of the page). */
  const ehExtraOpts = (url: string, clearnetHost = false): { cookieHeader?: string; proxy?: string } => {
    const s = settings.get();
    const onion = /\.onion\b/i.test(url);
    if (clearnetHost) {
      const clearnet = onion ? 'https://e-hentai.org' : url;
      return {
        cookieHeader: exAccounts.currentCookieHeader() || undefined,
        proxy: onion ? effectiveTorSocks() : proxyForUrl(clearnet, s, effectiveTorSocks()),
      };
    }
    return {
      cookieHeader: onion ? s.onion_cookies_raw : exAccounts.currentCookieHeader(),
      proxy: proxyForUrl(url, s, effectiveTorSocks()),
    };
  };

  handleSafe(CH.senkuroLabels, z.tuple([]), async () => {
    const s = settings.get();
    return await fetchSenkuroLabels(s.senkuro_cookies_raw, proxyForSource('senkuro', s, effectiveTorSocks()));
  });
  handleSafe(CH.ehTorrents, z.tuple([httpUrl]), async (_e, url) => fetchEhTorrents(url, ehExtraOpts(url, true)));
  handleSafe(CH.ehGalleryInfo, z.tuple([httpUrl]), async (_e, url) => fetchEhGalleryInfo(url, ehExtraOpts(url)));
  handleSafe(CH.ehFavorites, z.tuple([nonNegInt]), async (_e, page) => {
    const s = settings.get();
    const account = exAccounts.currentCookieHeader();
    const onionOnly = !account.trim() && !!s.onion_cookies_raw.trim();
    const base = onionOnly
      ? 'http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion'
      : 'https://e-hentai.org';
    return await fetchEhFavorites(base, page, {
      cookieHeader: onionOnly ? s.onion_cookies_raw : account,
      proxy: onionOnly ? effectiveTorSocks() : proxyForUrl(base, s, effectiveTorSocks()),
    });
  });

  handleSafe(CH.ehHathDownload, z.tuple([httpUrl, z.string().min(1).max(20)]), async (_e, url, resolution) => {
    const message = await ehHathDownload(url, resolution, ehExtraOpts(url, true));
    return { ok: true, message: message || 'Запрос на H@H отправлен' };
  });
  handleSafe(CH.ehResetImageLimit, z.tuple([]), async () => {    const s = settings.get();
    const torSocks = effectiveTorSocks();
    const accountCookie = exAccounts.currentCookieHeader();
    const onionCookie = s.onion_cookies_raw;
    const cookie = accountCookie || onionCookie;
    if (!cookie.trim()) throw new Error('Нет куки ExHentai — войди в аккаунт в настройках.');
    // The account pool is clearnet; an onion-only session must be reset through
    // the mirror it was created on.
    const base = accountCookie
      ? 'https://e-hentai.org'
      : 'http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion';
    const proxy = accountCookie
      ? s.tor_proxied_sites.includes('ehentai') || s.tor_proxied_sites.includes('exhentai') || s.builtin_tor
        ? torSocks
        : s.exhentai_proxy_addr.trim() || undefined
      : torSocks;
    return await resetEhImageLimit({ cookieHeader: cookie, proxy, base });
  });
  handleSafe(CH.checkSites, z.tuple([]), async () => {
    const s = settings.get();
    if (s.builtin_tor && !embeddedTorSocks()) {
      try {
        await whenEmbeddedTorReady(90_000);
      } catch {
        /* fall through: the checks will report the real reason */
      }
    }
    const torAddr = effectiveTorSocks();
    return await Promise.all(allSiteKeys().map((key) => probeSite(key, torAddr, s.tor_proxied_sites)));
  });
  handleSafe(CH.libMirrorsCheck, z.tuple([]), async () => {
    return await Promise.all(
      LIB_MIRRORS.map(async (host) => {
        // DNS gate first: a vanished record means a dead mirror server-side.
        try {
          await new Promise<void>((res, rej) => dnsPromiseLookup(host, (e: any) => (e ? rej(e) : res())));
        } catch (e: any) {
          return { host, ok: false, ms: -1, error: `DNS записи нет (зеркало удалено) — ${e?.code ?? 'ENOTFOUND'}` };
        }
        const start = Date.now();
        try {
          const r = await httpFetch({ url: `https://${host}/favicon.ico`, timeoutMs: 10000, frontOnEmpty: false });
          // Any HTTP answer (even 404 — many CDNs have no favicon) proves the
          // host is reachable; only network failures make it "bad".
          const reachable = r.status < 500;
          return reachable
            ? { host, ok: true, ms: Date.now() - start }
            : { host, ok: false, ms: Date.now() - start, error: `HTTP ${r.status}` };
        } catch (e: any) {
          return { host, ok: false, ms: -1, error: e?.message ?? String(e) };
        }
      }),
    );
  });
  handleSafe(CH.customDnsCheck, z.tuple([]), async () => {
    return await checkCustomDns('example.com');
  });

  return { fetchChapterListFor, fetchChapterListSafe, fetchChapterCountSafe };
}
