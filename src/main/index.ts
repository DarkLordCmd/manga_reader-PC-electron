import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { installAppCsp, installDefaultPermissions } from './security';
import { logger } from './services/logger';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { SettingsService } from './services/settings';
import { HistoryManager } from './services/history';
import { openDatabase } from './services/db';
import { LibraryService } from './services/library';
import { galleryFromFolder } from './services/gallery';
import { openZipGallery, isZipPath, clearZipTmpAll } from './services/zip-gallery';
import { fetchChapterList, searchMangaDex, fetchChapterCount } from './services/mangadex';
import { createOnlineGallery, setReadingPosition } from './services/online-gallery';
import { resolveGallery, UnsupportedUrlError, type GalleryResolution } from './services/resolve-gallery';
import { fetchRemangaChapters, fetchSenkuroChapters } from './services/sources';
import { fetchMangaShiChapters } from './services/catalog-search';
import { startEmbeddedTor, stopEmbeddedTor, embeddedTorSocks, whenEmbeddedTorReady } from './services/tor-embedded';
import { fetchMangaMelloChapters } from './services/catalog-search';
import { searchGrouple, GROUPLE_SITES, fetchGroupleChapters } from './services/catalog-search';
import type { SimpleSiteConfig } from './services/sources/catalog-types';
import {
  searchExHentai,
  searchMangaShi,
  searchMangaMello,
  searchNhentai,
  searchRemanga,
  searchSenkuro,
  searchSimpleSite,
} from './services/catalog-search';
import { enrichNhentaiPageCounts } from './services/sources/nhentai';
import { fetchEhPopular } from './services/sources/eh';
import { runLoginWindow } from './services/login';
import { probeSocks5Handshake, probeBridgeLine, probeSite, allSiteKeys } from './services/tor-check';
import { fetchEhTagSuggest, fetchNhentaiTagSuggestions } from './services/tags';
import { fetchCoverBuffer } from './services/covers';
import { setFrontingEnabled } from './services/domain-fronting';
import { setTorFallbackAddr } from './services/http';
import { shutdownBrowserFetch } from './services/browser-fetch';
import { ExAccountsService, parseCookieLogin } from './services/accounts';
import { setEhSetCookieHandler } from './services/eh-session';
import { PinService } from './services/pin';
import { ehWatcher, broadcastEhLimitState } from './services/eh-limits-instance';
import { registerEhLimitHook } from './services/eh-limits-hook';
import { httpFetchBinary, httpFetch } from './services/http';
import { setLibMirror, LIB_MIRRORS } from './services/lib-mirror';
import { setCustomDnsServers, parseDnsServerList, checkCustomDns } from './services/custom-dns';
import { initCookieStore } from './services/comx-gate';
import { lookup as dnsPromiseLookup } from 'dns';
import { DownloadManager } from './services/download-manager';
import { GoogleAuth } from './services/google-auth';
import { GoogleDrive } from './services/google-drive';
import { SyncService } from './services/sync';
import { CH } from '@shared/ipc';
import { z } from 'zod';
import { handleSafe, existingDirOrArchive, httpUrl } from './ipc/validate';
import { createWindow, registerLifecycle } from './windows';
import { registerMangaProtocol } from './protocol';
import { registerSettings } from './ipc/settings';
import { registerPin } from './ipc/pin';
import { registerLibrary } from './ipc/library';
import { registerDownloads } from './ipc/downloads';
import {
  galleries,
  onlineHeaders,
  coverCache,
  coverInFlight,
  getCoverDisk,
  zipMeta,
  ZIP_TMP,
  isGroupleWarming,
  setGroupleWarming,
  groupleCache,
} from './app/state';

// Grouple (readmanga etc.) catalog cache: warmed at boot so switching to the
// source renders instantly (the site itself needs Tor and builds slowly).
async function refreshGroupleCache(source: string): Promise<void> {
  const idx = ({ readmanga: 0, mintmanga: 1, mangapoisk: 2 } as const)[source as keyof typeof groupleIdxMap] ?? undefined;
  if (idx === undefined) return;
  const cfg = GROUPLE_SITES[idx] as SimpleSiteConfig;
  try {
    const s = settings.get();
    const torSocks = effectiveTorSocks();
    const items = await searchGrouple(cfg, '', 0, undefined, { proxy: torSocks });
    groupleCache.set(source, { base: (cfg as any).base || '', items, ts: Date.now() });
  } catch {
    /* tor not ready — cached merely stays old */
  }
}

const groupleIdxMap = { readmanga: 0, mintmanga: 1, mangapoisk: 2 } as const;

// Chromium network-stack hardening for the direct (net.fetch) path:
// ECH encrypts the SNI extension for sites that publish ECH configs (typical
// for Cloudflare-fronted hosts like nhentai), hiding it from SNI-based DPI.
// QUIC/HTTP-3 is already on by default in the network service.
app.commandLine.appendSwitch('enable-features', 'EncryptedClientHello');

function downloadsDirBase(dir: string | null | undefined): string {
  return dir?.trim() || join(app.getPath('userData'), 'downloads');
}

let settings: SettingsService;
let history: HistoryManager;
let library: LibraryService;
let exAccounts: ExAccountsService;
let downloads: DownloadManager;
let pin: PinService;
let sync: SyncService;

function coverMaxBytes(): number {
  return Math.max(16, Number(settings.get().cover_cache_mb) || 256) * 1024 * 1024;
}

function getCover(url: string): Promise<Buffer> {
  const cached = coverCache.get(url);
  if (cached) return Promise.resolve(cached);
  const inFlight = coverInFlight.get(url);
  if (inFlight) return inFlight;
  const p = (async () => {
    try {
      // L2: persistent on-disk cache — survives restarts so library/favorites/
      // history covers are not refetched every launch.
      const disk = getCoverDisk(coverMaxBytes);
      const onDisk = await disk.get(url);
      if (onDisk) {
        coverCache.set(url, onDisk);
        return onDisk;
      }
      const buf = await fetchCoverBuffer(url, settings.get(), exAccounts.currentCookieHeader());
      coverCache.set(url, buf);
      void disk.put(url, buf);
      return buf;
    } finally {
      coverInFlight.delete(url);
    }
  })();
  coverInFlight.set(url, p);
  return p;
}

/** Effective Tor SOCKS address: the bundled daemon (when enabled and up)
 * overrides the configured/user-provided address. */
function effectiveTorSocks(): string {
  const embedded = embeddedTorSocks();
  if (embedded) return embedded;
  return settings?.get().tor_socks_addr || '127.0.0.1:9150';
}

app.whenReady().then(() => {
  installAppCsp(process.env['ELECTRON_RENDERER_URL']);
  installDefaultPermissions(session.defaultSession);
  settings = new SettingsService(app.getPath('userData'));
  setFrontingEnabled(settings.get().enable_domain_fronting);
  setTorFallbackAddr(effectiveTorSocks());
  setLibMirror(settings.get().lib_image_server ?? null);
  setCustomDnsServers(parseDnsServerList(settings.get().custom_dns ?? ''));
  initCookieStore(app.getPath('userData'));
  // Bundled Tor daemon: start it as early as possible so by the time the
  // user hits an onion source the bootstrap is (usually) done.
  if (settings.get().builtin_tor) {
    void startEmbeddedTor(settings.get().tor_bridges, app.getPath('userData')).then((r) => {
      if (r) setTorFallbackAddr(effectiveTorSocks());
    });
  }
  app.on('before-quit', () => stopEmbeddedTor());
  // Warm the grouple catalogs in the background a few seconds after boot
  // (give Tor time to settle) — opening the sources then becomes instant.
  setTimeout(() => {
    void (async () => {
      if (isGroupleWarming()) return;
      setGroupleWarming(true);
      try {
        await refreshGroupleCache('readmanga');
        await refreshGroupleCache('mintmanga');
        await refreshGroupleCache('mangapoisk');
      } finally {
        setGroupleWarming(false);
      }
    })();
  }, 5000);
  pin = new PinService(app.getPath('userData'));
  registerPin({ pin });
  exAccounts = new ExAccountsService(app.getPath('userData'));
  exAccounts.init();
  registerEhLimitHook({
    watcher: ehWatcher,
    switchAccount: () => {
      const accs = exAccounts.accounts;
      if (accs.length === 0) return false;
      const idx = accs.findIndex((a) => a.id === exAccounts.currentId);
      const next = accs[(idx + 1) % accs.length] ?? accs[0];
      if (!next || next.id === exAccounts.currentId) return false;
      exAccounts.setCurrent(next.id);
      return true;
    },
  });
  ehWatcher.onChange(broadcastEhLimitState);
  ipcMain.handle(CH.ehLimitsState, () => ehWatcher.state());
  setEhSetCookieHandler((_host, setCookies) => exAccounts.mergeSetCookies(setCookies));
  const { db, repo } = openDatabase(app.getPath('userData'));
  history = new HistoryManager(repo);
  history.load(settings.get().viewing_history);
  library = new LibraryService(repo, { autoAdd: () => settings.get().library_auto_add });

  const googleAuth = new GoogleAuth(app.getPath('userData'));
  const googleDrive = new GoogleDrive(googleAuth);
  const syncStatePath = join(app.getPath('userData'), 'sync-state.json');
  let settingsUpdatedAt = Date.now();
  try {
    settingsUpdatedAt = JSON.parse(readFileSync(syncStatePath, 'utf8')).settingsUpdatedAt ?? settingsUpdatedAt;
  } catch {
    /* ignore */
  }
  const persistSyncState = (): void => {
    try {
      writeFileSync(syncStatePath, JSON.stringify({ settingsUpdatedAt }));
    } catch {
      /* ignore */
    }
  };
  sync = new SyncService({
    repo,
    getSettings: () => settings.get(),
    saveSettings: (s) => {
      settings.save(s);
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.settingsChanged, s);
    },
    getSettingsUpdatedAt: () => settingsUpdatedAt,
    setSettingsUpdatedAt: (t) => {
      settingsUpdatedAt = t;
      persistSyncState();
    },
    isEnabled: () => settings.get().sync_auto && settings.get().sync_enabled,
    onImported: () => broadcastLibrary(),
    drive: googleDrive,
    authStatus: () => googleAuth.status(),
    onChanged: (st) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.syncChanged, st);
    },
  });
  ipcMain.handle(CH.googleAuthStatus, () => googleAuth.status());
  ipcMain.handle(CH.googleLogin, async () => {
    const r = await googleAuth.login();
    return googleAuth.status();
  });
  ipcMain.handle(CH.googleLogout, async () => {
    await googleAuth.logout();
  });
  ipcMain.handle(CH.syncNow, () => sync!.syncNow());
  ipcMain.handle(CH.syncGetState, () => sync!.getState());
  if (googleAuth.status().authed) {
    setTimeout(() => {
      sync?.scheduleSync();
    }, 3000);
  }

  downloads = new DownloadManager(downloadsDirBase(settings.get().downloads_dir), join(app.getPath('userData'), 'downloads.json'), {
    fetchBinary: (url, headers, proxy, timeoutMs) => httpFetchBinary(url, headers ?? {}, proxy, timeoutMs),
    broadcast: (tasks) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.downloadsChanged, tasks);
    },
  });

  async function fetchChapterListFor(mangaId: string): Promise<{ chapter_id: string; chapter_num: string; title: string | null }[]> {
    let chapters;
    if (mangaId.includes('remanga.org')) {
      chapters = await fetchRemangaChapters(mangaId);
    } else if (mangaId.includes('senkuro')) {
      const slug = mangaId.trim().replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? mangaId;
      chapters = await fetchSenkuroChapters(slug, settings.get().onion_cookies_raw);
    } else if (mangaId.includes('mangalib')) {
      const { mangalibChapters, mangalibChapterUrl, mangalibChapterSortKey } = await import('./services/sources/mangalib');
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
      const { fetchComxChapters } = await import('./services/sources/comx');
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

  registerDownloads({
    downloads,
    settings,
    exAccounts,
    effectiveTorSocks,
    resolveGallery,
    fetchChapterCountSafe,
    fetchChapterListSafe,
  });

  registerSettings({
    settings,
    sync,
    repo,
    exAccounts,
    downloads,
    db,
    coverCache,
    getCoverDisk: () => getCoverDisk(coverMaxBytes),
    broadcastSettingsChanged: (s) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.settingsChanged, s);
    },
    broadcastLibraryChanged: () => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.libraryChanged);
    },
    effectiveTorSocks,
    downloadsDirBase,
  });

  registerMangaProtocol({
    state: { galleries, zipMeta, onlineHeaders, ZIP_TMP },
    settings,
    getCover,
    whenEmbeddedTorReady,
    embeddedTorSocks,
  });

  function broadcastLibrary(): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.libraryChanged);
    sync?.scheduleSync();
  }

  registerLibrary({ library, history, settings, sync, broadcastLibrary });

  ipcMain.handle(CH.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'openFile'] });
    if (r.canceled || r.filePaths.length === 0) return null;
    return openFolder(r.filePaths[0]);
  });
  handleSafe(CH.openFolder, z.tuple([existingDirOrArchive]), (_e, path) => openFolder(path));
  handleSafe(
    CH.openUrl,
    z.tuple([
      httpUrl,
      z.number().int().min(0).optional(),
      z.union([z.string(), z.null()]).optional(),
      z.union([z.string(), z.null()]).optional(),
      z.union([z.string(), z.null()]).optional(),
    ]),
    async (_e, url, startPage, mangaId, coverUrl, kind) => {
      const trimmed = url.trim();
      const s = settings.get();
      const torSocks = effectiveTorSocks();
      const useTor =
        url.includes('.onion') ||
        (url.includes('nhentai') && s.tor_proxied_sites.includes('nhentai')) ||
        (url.includes('e-hentai.org') && s.tor_proxied_sites.includes('ehentai')) ||
        (url.includes('exhentai.org') && (s.tor_proxied_sites.includes('ehentai') || s.tor_proxied_sites.includes('exhentai'))) ||
        (url.includes('com-x.life') && s.tor_proxied_sites.includes('comx')) ||
        (url.includes('senkuro') && s.tor_proxied_sites.includes('senkuro')) ||
        (url.includes('manga-shi') && s.tor_proxied_sites.includes('mangashi')) ||
        (url.includes('remanga') && s.tor_proxied_sites.includes('remanga')) ||
        (url.includes('mangalib') && s.tor_proxied_sites.includes('mangalib'));
      let proxy = useTor ? torSocks : undefined;
      // Mangalib: dedicated proxy (e.g. a Belarus-exit SOCKS/HTTP) when configured.
      if (!useTor && url.includes('mangalib') && s.mangalib_proxy_addr.trim()) proxy = s.mangalib_proxy_addr.trim();
      // Clearnet ExHentai/E-Hentai uses the active account pool cookies and,
      // if configured, the dedicated exhentai_proxy_addr proxy.
      const isClearnetEx = url.includes('exhentai') || url.includes('e-hentai.org');
      const cookieHeader = url.includes('.onion')
        ? s.onion_cookies_raw
        : isClearnetEx
          ? exAccounts.currentCookieHeader()
          : s.onion_cookies_raw;
      if (isClearnetEx && !url.includes('.onion') && s.exhentai_proxy_addr.trim()) proxy = s.exhentai_proxy_addr.trim();
      let result: GalleryResolution;
      try {
        result = await resolveGallery(trimmed, { proxy, cookieHeader });
      } catch (e) {
        if (e instanceof UnsupportedUrlError) return null;
        throw e;
      }
      // If no series url was derived, fall back to the caller-provided mangaId (original behavior).
      const seriesId = result.seriesId === trimmed ? (mangaId ?? trimmed) : result.seriesId;

      const gid = createOnlineGallery(result.title, result.pageUrls, result.proxy);
      const headers: Record<string, string> = {};
      if (result.referer) headers.Referer = result.referer;
      if (cookieHeader && (trimmed.includes('.onion') || trimmed.includes('exhentai') || trimmed.includes('e-hentai.org')))
        headers.Cookie = cookieHeader;
      onlineHeaders.set(gid, headers);

      history.addOrUpdate({
        url: trimmed,
        series_id: seriesId,
        title: result.title,
        cover_url: coverUrl ?? result.coverUrl,
        source: result.source,
        chapter_label: null,
        chapter_index: null,
        chapter_total: null,
        total_pages: result.pageUrls.length,
        kind: kind ?? null,
        category: trimmed.includes('nhentai') || trimmed.includes('exhentai') || trimmed.includes('e-hentai.org') ? 'r34' : 'main',
      });
      settings.save({ ...settings.get(), viewing_history: history.toVec() });
      library.autoAddIfNeeded(trimmed, seriesId);
      if (startPage && startPage > 0 && startPage < result.pageUrls.length) setReadingPosition(gid, startPage);
      if (process.env.MR_DEBUG === '1') {
        logger.info(
          '[debug] openUrl',
          trimmed,
          'startPage=',
          startPage,
          'pages=',
          result.pageUrls.length,
          'source=',
          result.source,
          'seriesId=',
          seriesId,
        );
      }
      // Long-strip formats (RU aggregators + local folders of stitched strips):
      // the reader renders them as a continuous vertical strip without margins.
      const webtoon = /senkuro|remanga|manga-shi|mangalib|libmir|mangamello|mangadex\.org\/(manga|chapter)/i.test(trimmed);
      return {
        id: gid,
        title: result.title,
        pageCount: result.pageUrls.length,
        source: result.source,
        url: trimmed,
        mangaId: seriesId,
        webtoon,
      };
    },
  );
  ipcMain.handle(CH.fetchChapterList, async (_e, mangaId: string) => {
    return await fetchChapterListFor(mangaId);
  });
  ipcMain.handle(
    CH.searchCatalog,
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
              for (const w of BrowserWindow.getAllWindows()) {
                try {
                  w.webContents.send(CH.nhentaiCounts, [{ url, pages }]);
                } catch {
                  /* ignore */
                }
              }
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
        const { searchComx } = await import('./services/sources/comx');
        const { COMX_BASE } = await import('./services/sources/comx');
        return await searchComx(
          { name: 'Com-X', base: COMX_BASE, catalogPath: '/comix-read/', searchPath: '/search/', linkMarker: '.html' },
          query,
          page,
          { proxy, category: filters.comxCategory, genre: filters.comxGenre },
        );
      }
      if (source === 'mangalib') {
        const { searchMangalib } = await import('./services/sources/mangalib');
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
  ipcMain.handle(CH.catalogPopular, async (_e, source: 'ehentai' | 'exhentai' | 'exhentai_onion') => {
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
  });
  ipcMain.handle(CH.loginSite, async (_e, url: string) => {
    const s = settings.get();
    // Tor only for the sites that actually need it (.onion, E-Hentai family,
    // nhentai) — routing other logins through a Tor exit gets them banned
    // (senkuro.me bans datacenter/Tor ranges).
    const lower = url.toLowerCase();
    const needsTor = url.includes('.onion') || lower.includes('exhentai') || lower.includes('e-hentai') || lower.includes('nhentai');
    const result = await runLoginWindow(url, needsTor ? effectiveTorSocks() : '');
    if (!result) return null;
    // Persist cookies into settings depending on target
    const next = { ...settings.get() };
    if (url.includes('exhentai')) next.onion_cookies_raw = result.cookies;
    else if (url.includes('nhentai')) {
      if (url.includes('.onion')) next.nhentai_onion_cookies_raw = result.cookies;
      else next.nhentai_cookies_raw = result.cookies;
    } else if (url.includes('senkuro')) {
      next.senkuro_cookies_raw = result.cookies;
    }
    settings.save(next);
    return result.cookies;
  });
  ipcMain.handle(CH.loginPassword, async (_e, user: string, pass: string) => {
    const r = await exAccounts.passwordLogin(user, pass);
    if (r.ok) {
      const s = settings.get();
      // Keep the account pool in sync with the cookie header used for clearnet ExHentai.
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.settingsChanged, s);
    }
    return r;
  });
  ipcMain.handle(CH.cookieLogin, async (_e, input: any) => {
    return await exAccounts.cookieLogin({
      ipbMemberId: String(input?.ipbMemberId ?? ''),
      ipbPassHash: String(input?.ipbPassHash ?? ''),
      igneous: input?.igneous ?? null,
      verify: input?.verify !== false,
    });
  });
  ipcMain.handle(CH.refreshIgneous, async () => await exAccounts.refreshIgneous());
  ipcMain.handle(CH.parseCookieText, (_e, text: string) => parseCookieLogin(String(text ?? '')));
  ipcMain.handle(CH.ehTagSuggest, async (_e, text: string) => {
    const s = settings.get();
    const proxy = s.tor_proxied_sites.includes('ehentai') ? effectiveTorSocks() : s.exhentai_proxy_addr.trim() || undefined;
    return await fetchEhTagSuggest(text, { proxy, cookieHeader: exAccounts.currentCookieHeader() || s.onion_cookies_raw });
  });
  ipcMain.handle(CH.nhentaiTagSuggest, async (_e, text: string) => {
    const s = settings.get();
    const proxy = s.tor_proxied_sites.includes('nhentai') ? effectiveTorSocks() : undefined;
    return await fetchNhentaiTagSuggestions(text, { proxy });
  });
  ipcMain.handle(CH.checkTor, async () => {
    const s = settings.get();
    return await probeSocks5Handshake(effectiveTorSocks());
  });
  ipcMain.handle(CH.checkBridges, async (_e, lines: string[]) => {
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
  ipcMain.handle(CH.setReadingPosition, (_e, gid: string, index: number) => {
    setReadingPosition(gid, index);
  });
  handleSafe(CH.rescanFolder, z.tuple([existingDirOrArchive]), (_e, path) => {
    const g = galleryFromFolder(path);
    if (!g) return null;
    galleries.set(g.id, g);
    return { id: g.id, title: g.title, pageCount: g.pages.length, pages: g.pages, url: `file://${path}` };
  });
  ipcMain.handle(CH.getExAccounts, () => ({ accounts: exAccounts.accounts, currentId: exAccounts.currentId }));
  ipcMain.handle(CH.setExAccount, (_e, id: number) => {
    exAccounts.setCurrent(id);
    return { accounts: exAccounts.accounts, currentId: exAccounts.currentId };
  });
  ipcMain.handle(CH.addExAccount, (_e, name: string, memberId: string, passHash: string, igneous: string) => {
    exAccounts.addManual(name, memberId, passHash, igneous);
    return { accounts: exAccounts.accounts, currentId: exAccounts.currentId };
  });
  ipcMain.handle(CH.removeExAccount, (_e, id: number) => {
    exAccounts.remove(id);
    return { accounts: exAccounts.accounts, currentId: exAccounts.currentId };
  });
  ipcMain.handle(CH.importExAccounts, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Выбери JSON, который сохранил юзерскрипт AutoLogin',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    let content: string;
    try {
      content = readFileSync(r.filePaths[0], 'utf-8');
    } catch (e: any) {
      return { count: 0, accounts: { accounts: exAccounts.accounts, currentId: exAccounts.currentId } };
    }
    const count = exAccounts.importFromContent(content);
    return { count, accounts: { accounts: exAccounts.accounts, currentId: exAccounts.currentId } };
  });

  createWindow();
});

async function openFolder(path: string): Promise<{ id: string; title: string; pageCount: number; pages: string[]; url: string } | null> {
  if (isZipPath(path)) {
    const zi = await openZipGallery(path, ZIP_TMP);
    if (!zi) return null;
    zipMeta.set(zi.id, { zipPath: path, entries: zi.entries });
    const url = `file://${path}`;
    history.addOrUpdate({
      url,
      series_id: url,
      title: zi.title,
      cover_url: null,
      source: 'Локальный архив',
      chapter_label: null,
      chapter_index: null,
      chapter_total: null,
      total_pages: zi.pageCount,
      category: 'main',
    });
    settings.save({ ...settings.get(), viewing_history: history.toVec() });
    return { id: zi.id, title: zi.title, pageCount: zi.pageCount, pages: zi.entries, url };
  }
  const g = galleryFromFolder(path);
  if (!g) return null;
  galleries.set(g.id, g);
  const s = settings.get();
  settings.save({ ...s, last_folder: path });
  const url = `file://${path}`;
  history.addOrUpdate({
    url,
    series_id: url,
    title: g.title,
    cover_url: null,
    source: 'Локальная папка',
    chapter_label: null,
    chapter_index: null,
    chapter_total: null,
    total_pages: g.pages.length,
    category: 'main',
  });
  settings.save({ ...settings.get(), viewing_history: history.toVec() });
  return { id: g.id, title: g.title, pageCount: g.pages.length, pages: g.pages, url };
}

registerLifecycle({
  onWillQuit: () => {
    clearZipTmpAll(ZIP_TMP);
    void shutdownBrowserFetch();
  },
});
