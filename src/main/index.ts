import { app, BrowserWindow, dialog, session } from 'electron';
import { installAppCsp, installDefaultPermissions } from './security';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { SettingsService } from './services/settings';
import { logger } from './services/logger';
import { HistoryManager } from './services/history';
import { openDatabase } from './services/db';
import { LibraryService } from './services/library';
import { galleryFromFolder } from './services/gallery';
import { openZipGallery, isZipPath, clearZipTmpAll } from './services/zip-gallery';
import { createOnlineGallery, setReadingPosition } from './services/online-gallery';
import { resolveGallery } from './services/resolve-gallery';
import { startEmbeddedTor, stopEmbeddedTor, embeddedTorSocks, whenEmbeddedTorReady, requestNewTorCircuit } from './services/tor-embedded';
import { searchGrouple, GROUPLE_SITES } from './services/catalog-search';
import type { SimpleSiteConfig } from './services/sources/catalog-types';
import { fetchCoverBuffer, setCoverTorResolver } from './services/covers';
import { runLoginWindow } from './services/login';
import { setFrontingEnabled } from './services/domain-fronting';
import { setTorFallbackAddr, setTorCircuitReset, warmTorCircuits } from './services/http';
import { shutdownBrowserFetch } from './services/browser-fetch';
import { ExAccountsService } from './services/accounts';
import { setEhSetCookieHandler } from './services/eh-session';
import { PinService } from './services/pin';
import { ehWatcher, broadcastEhLimitState } from './services/eh-limits-instance';
import { registerEhLimitHook } from './services/eh-limits-hook';
import { httpFetchBinary } from './services/http';
import { setLibMirror } from './services/lib-mirror';
import { setCustomDnsServers, parseDnsServerList } from './services/custom-dns';
import { rememberSettingsSecrets } from './services/settings-snapshot';
import { seriesKeyForUrl } from './services/series-key';
import { fetchSenkuroMangaTitle, senkuroMangaSlugFromUrl } from './services/sources';
import { proxyForUrl } from './services/proxy-policy';
import { initCookieStore } from './services/comx-gate';
import { initPageCache } from './services/page-cache';
import { DownloadManager } from './services/download-manager';
import { GoogleAuth } from './services/google-auth';
import { GoogleDrive } from './services/google-drive';
import { SyncService } from './services/sync';
import { CH } from '@shared/ipc';
import { createWindow, registerLifecycle } from './windows';
import { registerMangaProtocol, registerAppProtocol } from './protocol';
import { registerSettings } from './ipc/settings';
import { registerPin } from './ipc/pin';
import { registerLibrary } from './ipc/library';
import { reclassifySenkuroR34 } from './services/senkuro-r34';
import { proxyForSource } from './services/proxy-policy';
import { registerSenkuroImport } from './ipc/senkuro-import';
import { registerDownloads } from './ipc/downloads';
import { registerCatalog } from './ipc/catalog';
import { registerGallery } from './ipc/gallery';
import { registerAccounts } from './ipc/accounts';
import { registerSync, broadcastSyncChanged } from './ipc/sync';
import { registerEhLimits } from './ipc/eh-limits';
import { registerAutoUpdater } from './updater';
import type { Settings } from '@shared/settings';
import {
  galleries,
  onlineHeaders,
  coverCache,
  cacheCover,
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

/** Covers are the bulk of a cold catalog render (30 cards). Firing all of them
 * at Tor at once queues everything behind one congested circuit, so the visible
 * ones arrive last. Slots keep a steady stream ordered by request time. */
const COVER_CONCURRENCY = 6;
let coverActive = 0;
const coverWaiters: (() => void)[] = [];
/** Acquire a slot; on contention the promise resolves only when a running
 * request hands its slot over. */
function acquireCoverSlot(): Promise<void> | void {
  if (coverActive < COVER_CONCURRENCY) {
    coverActive++;
    return;
  }
  return new Promise<void>((resolve) => coverWaiters.push(resolve));
}
function releaseCoverSlot(): void {
  // Transfer the slot to the next waiter instead of decrementing first: the
  // old decrement-then-wake order let a racing caller see a free slot, take it,
  // and only then have the woken waiter increment too — overshooting the limit
  // and queueing more simultaneous Tor requests than intended.
  const next = coverWaiters.shift();
  if (next) next();
  else coverActive--;
}
async function withCoverSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireCoverSlot();
  try {
    return await fn();
  } finally {
    releaseCoverSlot();
  }
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
        cacheCover(url, onDisk);
        return onDisk;
      }
      const buf = await withCoverSlot(() => fetchCoverBuffer(url, settings.get(), exAccounts.currentCookieHeader()));
      cacheCover(url, buf);
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
  // Single instance: a second copy would open the same SQLite DB, downloads.json
  // and Tor ports (the embedded daemon cannot bind 9153 twice, and two writers
  // race on settings/downloads). Focus the existing window instead.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  // Crashes used to disappear into a closed window: log every one so a user
  // report can be traced back to a main/renderer/child-process failure.
  process.on('uncaughtException', (e) => logger.error('[crash] uncaughtException', e));
  process.on('unhandledRejection', (r) => logger.error('[crash] unhandledRejection', r));
  app.on('render-process-gone', (_e, _wc, details) =>
    logger.error('[crash] render-process-gone', details.reason, 'exit=', details.exitCode),
  );
  app.on('child-process-gone', (_e, details) => logger.error('[crash] child-process-gone', details.type, details.reason));

  installAppCsp(process.env['ELECTRON_RENDERER_URL']);
  installDefaultPermissions(session.defaultSession);
  settings = new SettingsService(app.getPath('userData'));
  // Covers must use the daemon that is actually running (the embedded one
  // listens on its own port even when tor_socks_addr still says 9150).
  setCoverTorResolver(() => effectiveTorSocks());
  setFrontingEnabled(settings.get().enable_domain_fronting);
  setTorFallbackAddr(effectiveTorSocks());
  setTorCircuitReset(() => requestNewTorCircuit());
  setLibMirror(settings.get().lib_image_server ?? null);
  setCustomDnsServers(parseDnsServerList(settings.get().custom_dns ?? ''));
  initCookieStore(app.getPath('userData'));
  initPageCache(app.getPath('userData'));
  // Extracted zip pages live under userData/tmp/zip and are a session-only
  // cache. They were only removed on a clean quit, so a crash (or a kill from
  // Task Manager) left a large directory behind forever. Clear on boot too.
  try {
    clearZipTmpAll(ZIP_TMP);
  } catch {
    /* best-effort */
  }
  // Bundled Tor daemon: start it as early as possible so by the time the
  // user hits an onion source the bootstrap is (usually) done.
  if (settings.get().builtin_tor) {
    void startEmbeddedTor(settings.get().tor_bridges, app.getPath('userData')).then((r) => {
      if (!r) return;
      const socks = effectiveTorSocks();
      setTorFallbackAddr(socks);
      // Build the first circuits while the UI is still starting, so the first
      // catalog page does not pay the circuit-build latency.
      warmTorCircuits(socks, ['e-hentai.org', 'exhentai.org', 'ehgt.org', 'api.senkuro.me', 'api.mangadex.org']);
    });
  }
  app.on('before-quit', () => void stopEmbeddedTor());
  // Warm the grouple catalogs in the background after boot. Wait for the
  // bundled daemon first: on a 5-second timer it was almost always still
  // bootstrapping, so the warm-up hit the (dead) user SOCKS address, failed,
  // and the cache stayed empty — the very cost this warm-up exists to remove.
  setTimeout(() => {
    void (async () => {
      if (isGroupleWarming()) return;
      setGroupleWarming(true);
      try {
        if (settings.get().builtin_tor) {
          try {
            await whenEmbeddedTorReady(90_000);
          } catch {
            /* fall through: the user's own Tor may still work */
          }
        }
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
  // The DB is now the source of truth. The settings copy was only a legacy
  // import source (HistoryManager.load) yet it was rewritten on every 5-second
  // progress flush — 78 KB of a 149 KB settings.json for a normal user. Drop it
  // once the DB has data; load() above has already imported it on first run.
  if (repo.allIncludingDeleted().length > 0 && settings.get().viewing_history.length > 0) {
    settings.save({ ...settings.get(), viewing_history: [] });
  }
  library = new LibraryService(repo, { autoAdd: () => settings.get().library_auto_add });

  const googleAuth = new GoogleAuth(app.getPath('userData'));
  const googleDrive = new GoogleDrive(googleAuth);
  const syncStatePath = join(app.getPath('userData'), 'sync-state.json');
  // 0, not Date.now(): without sync-state.json (fresh install, second PC) the
  // "last changed" stamp used to be the boot time, so freshly installed local
  // DEFAULTS beat the real settings already stored in Drive and overwrote the
  // user's profile on every device.
  let settingsUpdatedAt = 0;
  try {
    const parsed = JSON.parse(readFileSync(syncStatePath, 'utf8'));
    settingsUpdatedAt = Number.isFinite(parsed?.settingsUpdatedAt) ? parsed.settingsUpdatedAt : 0;
  } catch {
    /* first run — no local edits yet */
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
      // Record the secrets handed to the renderer, like broadcastSettingsChanged
      // does: otherwise the renderer's echo of this snapshot is not recognised
      // as stale and can overwrite a fresh login cookie.
      rememberSettingsSecrets(s);
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.settingsChanged, s);
    },
    getSettingsUpdatedAt: () => settingsUpdatedAt,
    setSettingsUpdatedAt: (t) => {
      settingsUpdatedAt = t;
      persistSyncState();
    },
    isEnabled: () => settings.get().sync_auto && settings.get().sync_enabled && googleAuth.status().authed,
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
    // The chapter list knows the real work title (Senkuro rows used to store the
    // chapter number as their title). Write it back so Library/History show the
    // work name instead of "1".
    onSeriesTitle: (seriesId: string, title: string) => {
      try {
        const key = seriesKeyForUrl(seriesId);
        const row = key ? repo.getIncludingDeleted(key) : repo.findByUrl(seriesId);
        if (!row || row.title === title) return;
        repo.setTitle(row.key, title);
        broadcastLibrary();
      } catch (e: any) {
        logger.warn('[title] repair failed:', e?.message ?? e);
      }
    },
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

  /** `exceptId` skips the window that initiated the change (it already applied
   * it optimistically): echoing the whole settings object back caused a full
   * re-render of the app on every toggle/zoom click. */
  const broadcastSettingsChanged = (s: Settings, exceptId?: number): void => {
    rememberSettingsSecrets(s);
    for (const w of BrowserWindow.getAllWindows()) {
      if (exceptId !== undefined && w.webContents.id === exceptId) continue;
      w.webContents.send(CH.settingsChanged, s);
    }
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
  registerAppProtocol();

  function broadcastLibrary(): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.libraryChanged);
    sync?.scheduleSync();
  }

  registerLibrary({ library, history, settings, sync, broadcastLibrary });
  registerSenkuroImport({ library, history, settings, effectiveTorSocks, broadcastLibrary, broadcastSettingsChanged });
  // Existing Senkuro imports predate the R34 flag; backfill their categories
  // from the Senkuro ratings in the background (a handful of batched requests).
  setTimeout(() => {
    const s = settings.get();
    void reclassifySenkuroR34({
      repo,
      cookieHeader: s.senkuro_cookies_raw,
      proxy: proxyForSource('senkuro', s, effectiveTorSocks()),
      cacheFile: join(app.getPath('userData'), 'senkuro-ratings.json'),
      onChange: () => broadcastLibrary(),
    }).catch((e) => logger.warn('[senkuro-r34] backfill failed', (e as Error)?.message ?? e));
  }, 2500);

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

  registerAutoUpdater();
  createWindow();

  // One-time background repair for rows saved before the title fix: a Senkuro
  // chapter node carries only its NUMBER as `name`, so History/Library rows were
  // titled "1", "3", "0". Fetch the real work title once per such row.
  setTimeout(() => {
    void (async () => {
      try {
        const numeric = repo
          .all()
          .filter((r) => /senkuro/i.test(r.source) && /^\d+([./]\d+)?$/.test(r.title))
          .slice(0, 20);
        for (const row of numeric) {
          const seriesUrl = row.seriesId || row.url;
          const slug = senkuroMangaSlugFromUrl(seriesUrl);
          if (!slug) continue;
          try {
            const s = settings.get();
            const proxy = proxyForUrl(seriesUrl, s, effectiveTorSocks());
            const title = await fetchSenkuroMangaTitle(slug, s.senkuro_cookies_raw, proxy);
            if (title) {
              repo.setTitle(row.key, title);
              broadcastLibrary();
            }
          } catch {
            /* transient — keep the old title */
          }
        }
      } catch {
        /* ignore */
      }
    })();
  }, 8000);
}).catch((e) => {
  // A throw during boot (locked/corrupt DB, permissions, full disk) used to be
  // swallowed by the unhandledRejection logger: the process stayed alive with
  // the single-instance lock held and NO window — a task-manager-only zombie.
  logger.error('[boot] failed', e);
  try {
    dialog.showErrorBox(
      'Не удалось запустить Manga Reader',
      `${e instanceof Error ? e.message : String(e)}\n\nЛог: ${app.getPath('userData')}\\logs`,
    );
  } catch {
    /* even the dialog failed — exit anyway */
  }
  app.exit(1);
});

registerLifecycle({
  onWillQuit: () => {
    clearZipTmpAll(ZIP_TMP);
    void shutdownBrowserFetch();
  },
});
