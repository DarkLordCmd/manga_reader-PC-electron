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
import { createOnlineGallery, setReadingPosition } from './services/online-gallery';
import { resolveGallery, UnsupportedUrlError, type GalleryResolution } from './services/resolve-gallery';
import { startEmbeddedTor, stopEmbeddedTor, embeddedTorSocks, whenEmbeddedTorReady } from './services/tor-embedded';
import { searchGrouple, GROUPLE_SITES } from './services/catalog-search';
import type { SimpleSiteConfig } from './services/sources/catalog-types';
import { runLoginWindow } from './services/login';
import { fetchCoverBuffer } from './services/covers';
import { setFrontingEnabled } from './services/domain-fronting';
import { setTorFallbackAddr } from './services/http';
import { shutdownBrowserFetch } from './services/browser-fetch';
import { ExAccountsService, parseCookieLogin } from './services/accounts';
import { setEhSetCookieHandler } from './services/eh-session';
import { PinService } from './services/pin';
import { ehWatcher, broadcastEhLimitState } from './services/eh-limits-instance';
import { registerEhLimitHook } from './services/eh-limits-hook';
import { httpFetchBinary } from './services/http';
import { setLibMirror } from './services/lib-mirror';
import { setCustomDnsServers, parseDnsServerList } from './services/custom-dns';
import { initCookieStore } from './services/comx-gate';
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
import { registerCatalog } from './ipc/catalog';
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

function broadcastNhentaiCounts(entries: { url: string; pages: number }[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.webContents.send(CH.nhentaiCounts, entries);
    } catch {
      /* ignore */
    }
  }
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

  const { fetchChapterListSafe, fetchChapterCountSafe } = registerCatalog({
    settings,
    effectiveTorSocks,
    exAccounts,
    whenEmbeddedTorReady,
    refreshGroupleCache,
    broadcastNhentaiCounts,
  });

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
