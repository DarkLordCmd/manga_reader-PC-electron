import { ipcMain } from 'electron';
import { lookup as dnsPromiseLookup } from 'dns';
import { z } from 'zod';
import { CH } from '@shared/ipc';
import type { CatalogCursor } from '@shared/ipc';
import { handleSafe, nonNegInt, anyString, stringArray } from './validate';
import type { SettingsService } from '../services/settings';
import type { ExAccountsService } from '../services/accounts';
import type { SimpleSiteConfig } from '../services/sources/catalog-types';
import {
  GROUPLE_SITES,
  searchGrouple,
  fetchGroupleChapters,
  searchMangaShi,
  searchMangaMello,
  searchNhentai,
  searchRemanga,
  searchSenkuro,
  searchExHentai,
  fetchMangaShiChapters,
  fetchMangaMelloChapters,
} from '../services/catalog-search';
import { searchMangaDex, fetchChapterCount, fetchChapterList } from '../services/mangadex';
import { fetchRemangaChapters, fetchSenkuroChapters } from '../services/sources';
import { enrichNhentaiPageCounts } from '../services/sources/nhentai';
import { fetchEhPopular } from '../services/sources/eh';
import { probeSocks5Handshake, probeBridgeLine, probeSite, allSiteKeys } from '../services/tor-check';
import { embeddedTorSocks } from '../services/tor-embedded';
import { fetchEhTagSuggest, fetchNhentaiTagSuggestions } from '../services/tags';
import { httpFetch } from '../services/http';
import { LIB_MIRRORS } from '../services/lib-mirror';
import { checkCustomDns } from '../services/custom-dns';
import { groupleCache } from '../app/state';

export interface CatalogDeps {
  settings: SettingsService;
  effectiveTorSocks(): string;
  exAccounts: ExAccountsService;
  whenEmbeddedTorReady(ms: number): Promise<unknown>;
  refreshGroupleCache(source: string): Promise<void>;
  broadcastNhentaiCounts(entries: { url: string; pages: number }[]): void;
}

export function registerCatalog(deps: CatalogDeps): {
  fetchChapterListFor(mangaId: string): Promise<{ chapter_id: string; chapter_num: string; title: string | null }[]>;
  fetchChapterListSafe(mangaId: string): Promise<{ chapter_id: string; chapter_num: string; title: string | null }[] | null>;
  fetchChapterCountSafe(mangaId: string): Promise<number | null>;
} {
  const { settings, effectiveTorSocks, exAccounts, whenEmbeddedTorReady, refreshGroupleCache } = deps;

  async function fetchChapterListFor(mangaId: string): Promise<{ chapter_id: string; chapter_num: string; title: string | null }[]> {
    let chapters;
    if (mangaId.includes('remanga.org')) {
      chapters = await fetchRemangaChapters(mangaId);
    } else if (mangaId.includes('senkuro')) {
      const slug = mangaId.trim().replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? mangaId;
      chapters = await fetchSenkuroChapters(slug, settings.get().senkuro_cookies_raw);
    } else if (mangaId.includes('mangalib')) {
      const { mangalibChapters, mangalibChapterUrl, mangalibChapterSortKey } = await import('../services/sources/mangalib');
      const s = settings.get();
      const mlProxy = s.tor_proxied_sites.includes('mangalib') ? effectiveTorSocks() : s.mangalib_proxy_addr.trim() || undefined;
      const slug = mangaId.trim().replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? mangaId;
      const list = await mangalibChapters(slug, mlProxy);
      chapters = list
        .sort((a, b) => mangalibChapterSortKey(a) - mangalibChapterSortKey(b))
        .map((c) => ({
          chapter_id: mangalibChapterUrl(slug, c),
          chapter_num: `Том ${c.volume} Глава ${c.number}${c.numberSecondary ? `.${c.numberSecondary}` : ''}${c.name ? ` — ${c.name}` : ''}`,
          title: null,
          lang: 'mangalib',
        }));
    } else if (mangaId.includes('manga-shi')) {
      const s = settings.get();
      const proxy = s.tor_proxied_sites.includes('mangashi') ? effectiveTorSocks() : undefined;
      chapters = await fetchMangaShiChapters(mangaId, proxy);
    } else if (mangaId.includes('mangamello')) {
      chapters = await fetchMangaMelloChapters(mangaId);
    } else if (/nhentai/.test(mangaId)) {
      // nhentai galleries have no chapter list: the whole gallery opens as a
      // single "chapter" (chapter_id = gallery URL, resolved by openUrl).
      return [{ chapter_id: mangaId, chapter_num: '1', title: null }];
    } else if (mangaId.includes('readmanga.') || mangaId.includes('mintmanga.') || mangaId.includes('mangapoisk.')) {
      chapters = await fetchGroupleChapters(mangaId, undefined, { proxy: effectiveTorSocks() });
    } else if (mangaId.includes('com-x.life')) {
      const { fetchComxChapters } = await import('../services/sources/comx');
      chapters = await fetchComxChapters(mangaId);
    } else if (mangaId.includes('exhentai') || mangaId.includes('e-hentai.org')) {
      // E-Hentai family galleries have no chapter list: the whole gallery
      // opens as a single "chapter" (chapter_id = gallery URL, resolved by openUrl).
      return [{ chapter_id: mangaId, chapter_num: '1', title: null }];
    } else {
      chapters = await fetchChapterList(mangaId);
    }
    return chapters.map((c) => ({ chapter_id: c.chapter_id, chapter_num: c.chapter_num, title: c.title }));
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
  handleSafe(
    CH.searchCatalog,
    z.tuple([
      z.string().max(64),
      anyString,
      nonNegInt,
      z.string().max(32),
      z.record(z.string(), z.unknown()).optional(),
      z.custom<CatalogCursor | null>().optional(),
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
        }));
      }
      if (source === 'remanga') return await searchRemanga(query, page, filters);
      if (source === 'senkuro') {
        // api.senkuro.me serves the browse catalog anonymously too; cookies
        // (when present) still carry the Authorization bearer token.
        return await searchSenkuro(query, s.senkuro_cookies_raw, cursor?.dir === 'next' ? cursor.cursor : undefined, {
          senkuroOrdering: filters.senkuroOrdering,
          senkuroStatuses: filters.senkuroStatuses,
          senkuroTypes: filters.senkuroTypes,
          senkuroFormats: filters.senkuroFormats,
          senkuroRating: filters.senkuroRating,
        });
      }
      if (source === 'mangashi') return await searchMangaShi(query, proxy, filters, page);
      if (source === 'mangamello') return await searchMangaMello(query, page);
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
        return items;
      }
      if (source === 'ehentai' || source === 'exhentai' || source === 'exhentai_onion') {
        const useOnion = source === 'exhentai_onion';
        const cookieHeader = useOnion ? s.onion_cookies_raw : exAccounts.currentCookieHeader();
        // The "E-Hentai" Tor toggle routes both e-hentai.org and exhentai.org
        // through Tor (same site family), like the original app.
        const torForEx = s.tor_proxied_sites.includes('ehentai') || s.tor_proxied_sites.includes('exhentai');
        const useTor = useOnion || torForEx;
        const exProxy = useTor ? torSocks : s.exhentai_proxy_addr.trim() || undefined;
        const ex = await searchExHentai(
          query,
          {
            cookieHeader,
            torSocksAddr: torSocks,
            useOnion,
            page,
            forceTor: torForEx,
            excludedCats: filters.ehExcludedCats,
            minRating: filters.ehMinRating,
            domainOverride: source === 'ehentai' ? 'https://e-hentai.org' : undefined,
            cursor: cursor ? { dir: cursor.dir, gid: cursor.cursor } : undefined,
          },
          exProxy,
        );
        return ex.map((c) => ({ url: c.url, title: c.title, coverUrl: c.coverUrl, pages: c.pages, score: c.rating, kind: c.category }));
      }
      if (source === 'comx') {
        const { searchComx } = await import('../services/sources/comx');
        const { COMX_BASE } = await import('../services/sources/comx');
        return await searchComx(
          { name: 'Com-X', base: COMX_BASE, catalogPath: '/comix-read/', searchPath: '/search/', linkMarker: '.html' },
          query,
          page,
          { proxy, category: filters.comxCategory, genre: filters.comxGenre },
        );
      }
      if (source === 'mangalib') {
        const { searchMangalib } = await import('../services/sources/mangalib');
        const mlProxy = s.tor_proxied_sites.includes('mangalib') ? torSocks : s.mangalib_proxy_addr.trim() || undefined;
        return await searchMangalib(query, page, mlProxy);
      }
      const groupleIdx = { readmanga: 0, mintmanga: 1, mangapoisk: 2 } as const;
      if (source in groupleIdx) {
        const cfg = GROUPLE_SITES[groupleIdx[source as keyof typeof groupleIdx]] as SimpleSiteConfig;
        // Fresh anonymous listing served from cache makes opening the source
        // instant (a Tor fetch takes ~2-5 s; the cache refreshes in bg).
        const cached = groupleCache.get(source);
        if (!query.trim() && cached && cached.base === cfg.base && Date.now() - cached.ts < 10 * 60_000) {
          // Refresh in the background so the next visit is still fresh.
          void refreshGroupleCache(source);
          return cached.items;
        }
        // Grouple hosts are TCP/SNI-blocked on most RU networks — always go
        // through Tor (direct attempts just burn 10-30 s of timeouts).
        const items = await searchGrouple(cfg, query, page, undefined, { proxy: torSocks });
        if (!query.trim() && page === 0) groupleCache.set(source, { base: cfg.base || '', items, ts: Date.now() });
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
      return ex.map((c) => ({ url: c.url, title: c.title, coverUrl: c.coverUrl, pages: c.pages, score: c.rating, kind: c.category }));
    },
  );
  handleSafe(CH.ehTagSuggest, z.tuple([anyString]), async (_e, text: string) => {
    const s = settings.get();
    const proxy = s.tor_proxied_sites.includes('ehentai') ? effectiveTorSocks() : s.exhentai_proxy_addr.trim() || undefined;
    return await fetchEhTagSuggest(text, { proxy, cookieHeader: exAccounts.currentCookieHeader() || s.onion_cookies_raw });
  });
  handleSafe(CH.nhentaiTagSuggest, z.tuple([anyString]), async (_e, text: string) => {
    const s = settings.get();
    const proxy = s.tor_proxied_sites.includes('nhentai') ? effectiveTorSocks() : undefined;
    return await fetchNhentaiTagSuggestions(text, { proxy });
  });
  ipcMain.handle(CH.checkTor, async () => {
    const s = settings.get();
    return await probeSocks5Handshake(effectiveTorSocks());
  });
  handleSafe(CH.checkBridges, z.tuple([stringArray]), async (_e, lines: string[]) => {
    return await Promise.all(lines.map((line) => probeBridgeLine(line)));
  });
  ipcMain.handle(CH.checkSites, async () => {
    const s = settings.get();
    const torAddr = effectiveTorSocks();
    return await Promise.all(allSiteKeys().map((key) => probeSite(key, torAddr, s.tor_proxied_sites)));
  });
  ipcMain.handle(CH.libMirrorsCheck, async () => {
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
  ipcMain.handle(CH.customDnsCheck, async () => {
    return await checkCustomDns('example.com');
  });

  return { fetchChapterListFor, fetchChapterListSafe, fetchChapterCountSafe };
}
