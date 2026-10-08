import { app, BrowserWindow, session } from 'electron';
import { installAppCsp, installDefaultPermissions } from './security';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { SettingsService } from './services/settings';
import { HistoryManager } from './services/history';
import { openDatabase } from './services/db';
import { LibraryService } from './services/library';
import { galleryFromFolder } from './services/gallery';
import { openZipGallery, isZipPath, clearZipTmpAll } from './services/zip-gallery';
import { createOnlineGallery, setReadingPosition } from './services/online-gallery';
import { resolveGallery } from './services/resolve-gallery';
import { startEmbeddedTor, stopEmbeddedTor, embeddedTorSocks, whenEmbeddedTorReady } from './services/tor-embedded';
import { searchGrouple, GROUPLE_SITES } from './services/catalog-search';
import type { SimpleSiteConfig } from './services/sources/catalog-types';
import { fetchCoverBuffer } from './services/covers';
import { runLoginWindow } from './services/login';
import { setFrontingEnabled } from './services/domain-fronting';
import { setTorFallbackAddr } from './services/http';
import { shutdownBrowserFetch } from './services/browser-fetch';
import { ExAccountsService } from './services/accounts';
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
import { createWindow, registerLifecycle } from './windows';
import { registerMangaProtocol } from './protocol';
import { registerSettings } from './ipc/settings';
import { registerPin } from './ipc/pin';
import { registerLibrary } from './ipc/library';
import { registerDownloads } from './ipc/downloads';
import { registerCatalog } from './ipc/catalog';
import { registerGallery } from './ipc/gallery';
import { registerAccounts } from './ipc/accounts';
import { registerSync, broadcastSyncChanged } from './ipc/sync';
import { registerEhLimits } from './ipc/eh-limits';
import type { Settings } from '@shared/settings';
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
  registerEhLimits({ ehWatcher });
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
    onChanged: broadcastSyncChanged,
  });
  registerSync({ googleAuth, sync });
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

  const broadcastSettingsChanged = (s: Settings): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.settingsChanged, s);
  };

  registerSettings({
    settings,
    sync,
    repo,
    exAccounts,
    downloads,
    db,
    coverCache,
    getCoverDisk: () => getCoverDisk(coverMaxBytes),
    broadcastSettingsChanged,
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

  registerGallery({
    settings,
    history,
    library,
    exAccounts,
    effectiveTorSocks,
    state: { galleries, zipMeta, ZIP_TMP },
    onlineHeaders,
    resolveGallery,
    createOnlineGallery,
    setReadingPosition,
    openZipGallery,
    galleryFromFolder,
    isZipPath,
  });

  registerAccounts({
    settings,
    exAccounts,
    effectiveTorSocks,
    runLoginWindow,
    broadcastSettingsChanged,
  });

  createWindow();
});

registerLifecycle({
  onWillQuit: () => {
    clearZipTmpAll(ZIP_TMP);
    void shutdownBrowserFetch();
  },
});
