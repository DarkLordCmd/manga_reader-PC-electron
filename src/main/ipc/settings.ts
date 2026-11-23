import { app, dialog, ipcMain } from 'electron';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { CH } from '@shared/ipc';
import type { BackupSummary } from '@shared/ipc';
import type { Settings } from '@shared/settings';
import { parseSettings } from '@shared/settings';
import { handleSafe, anyString, looseObject } from './validate';
import type { SettingsService } from '../services/settings';
import type { SyncService } from '../services/sync';
import { isPortableSettingsChanged } from '../services/sync';
import type { SqliteSeriesRepository } from '../services/sqlite-series-repository';
import type { ExAccountsService } from '../services/accounts';
import type { DownloadManager } from '../services/download-manager';
import type { CoverDiskCache } from '../services/cover-cache';
import { buildBackup, parseBackup, SECRET_SETTINGS } from '../services/backup';
import { setFrontingEnabled } from '../services/domain-fronting';
import { clearCoverFailureCache } from '../services/covers';
import { setEhOriginalImages } from '../services/online-gallery';
import { setEhListingCacheTtlMs } from '../services/sources/eh';
import { logger } from '../services/logger';
import { setTorFallbackAddr } from '../services/http';
import { setLibMirror } from '../services/lib-mirror';
import { setCustomDnsServers, parseDnsServerList } from '../services/custom-dns';
import { startEmbeddedTor, stopEmbeddedTor, embeddedTorSocks, getTorDiagnostics } from '../services/tor-embedded';
import { setCoverDiskMaxBytes } from '../app/state';
import {
  rememberSettingsSecrets,
  isRendererSnapshotSecret,
} from '../services/settings-snapshot';

/** Secret settings that are session/`.onion` cookies — the renderer's stale
 * snapshot must never blank them. Derived from SECRET_SETTINGS so the set of
 * cookie secrets stays in one place. */
type CookieSecretField = Extract<(typeof SECRET_SETTINGS)[number], `${string}_cookies_raw`>;
const COOKIE_SECRET_FIELDS = SECRET_SETTINGS.filter((k) => k.endsWith('_cookies_raw')) as CookieSecretField[];
// Main-owned bearer tokens (Remanga) must never be blanked by an old renderer snapshot.
const TOKEN_SECRET_FIELDS = ['remanga_token'] as const;

export function registerSettings(deps: {
  settings: SettingsService;
  sync?: SyncService | null;
  repo: SqliteSeriesRepository;
  exAccounts: ExAccountsService;
  downloads: DownloadManager;
  db: { pragma(sql: string): unknown };
  coverCache: Map<string, Buffer>;
  getCoverDisk: () => CoverDiskCache;
  broadcastSettingsChanged: (s: Settings, exceptId?: number) => void;
  broadcastLibraryChanged: () => void;
  effectiveTorSocks: () => string;
  downloadsDirBase: (dir: string | null | undefined) => string;
}): void {
  const { settings, sync, repo, exAccounts, downloads, db, coverCache } = deps;

  /**
   * Applies the runtime side effects of a settings object.
   *
   * MUST run after `settings.save()`: `deps.effectiveTorSocks()` and the Tor
   * daemon start/stop read `settings.get()`, so applying this before the save
   * used the OLD settings — changing `tor_socks_addr` left the SNI/Tor fallback
   * pointing at the previous port until the next restart.
   */
  function applyRuntimeSettings(next: Settings, prev: Settings): void {
    // Only the fields that ACTUALLY changed: this runs on every settings save
    // (each zoom click, icon toggle, quick-search edit). Re-applying everything
    // had real costs — `setCustomDnsServers` clears the whole DNS/DoH cache, so
    // any settings tweak forced every subsequent catalog/cover request to
    // re-resolve, and a failing built-in Tor was re-bootstrapped (TCP-probing
    // every bridge, up to 45 s per bridge) after every single save.
    if (next.enable_domain_fronting !== prev.enable_domain_fronting) setFrontingEnabled(!!next.enable_domain_fronting);
    if (next.eh_original_images !== prev.eh_original_images) setEhOriginalImages(!!next.eh_original_images);
    if (next.eh_listing_cache_minutes !== prev.eh_listing_cache_minutes) {
      setEhListingCacheTtlMs((Number(next.eh_listing_cache_minutes) || 0) * 60_000);
    }
    if ((next.lib_image_server ?? null) !== (prev.lib_image_server ?? null)) setLibMirror(next.lib_image_server ?? null);
    if ((next.custom_dns ?? null) !== (prev.custom_dns ?? null)) setCustomDnsServers(parseDnsServerList(next.custom_dns ?? ''));
    if (next.cover_cache_mb !== prev.cover_cache_mb) {
      setCoverDiskMaxBytes(Math.max(16, Number(next.cover_cache_mb) || 256) * 1024 * 1024);
    }
    const before = deps.downloadsDirBase(prev.downloads_dir);
    const after = deps.downloadsDirBase(next.downloads_dir);
    if (before !== after) downloads.setOutDirBase(after);
    const bridgesChanged = (next.tor_bridges ?? '') !== (prev.tor_bridges ?? '');
    if (next.builtin_tor !== prev.builtin_tor || bridgesChanged) {
      // A new network path makes every "dead cover" verdict obsolete.
      clearCoverFailureCache();
      if (!next.builtin_tor) {
        // Stop UNCONDITIONALLY: embeddedTorSocks() is null for the whole
        // bootstrap, so a guard on it left the daemon booting (and then routing
        // traffic through Tor) after the toggle was switched off.
        void stopEmbeddedTor();
      } else {
        const start = (): void => {
          void startEmbeddedTor(next.tor_bridges ?? '', app.getPath('userData')).then((r) => {
            if (r) setTorFallbackAddr(deps.effectiveTorSocks());
          });
        };
        // A new bridge list must apply even while the old list is still
        // bootstrapping (activeSocks is null until Bootstrapped 100%, so the
        // old `&& embeddedTorSocks()` condition silently ignored the edit for
        // the whole 10-45 s window).
        if (bridgesChanged) void stopEmbeddedTor().then(start);
        else start();
      }
    }
    setTorFallbackAddr(deps.effectiveTorSocks());
  }

  handleSafe(CH.backupExport, z.tuple([z.boolean()]), async (_e, includeSecrets: boolean) => {
    const r = await dialog.showSaveDialog({
      title: 'Экспорт данных',
      defaultPath: `manga-reader-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    const data = buildBackup(settings.get(), repo.all(), exAccounts.accounts, downloads.list(), !!includeSecrets);
    try {
      // 0600: with includeSecrets this file holds decrypted cookies, proxy
      // credentials and Tor bridges; default 0644 left them world-readable.
      writeFileSync(r.filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch (e: any) {
      // Read-only folder / no space / revoked network drive: report it instead
      // of an unhandled rejection that left the user with no file and no message.
      dialog.showErrorBox('Экспорт не выполнен', e?.message ?? String(e));
      return null;
    }
    return { canceled: false, path: r.filePath };
  });

  handleSafe(CH.backupImport, z.tuple([]), async () => {
    const r = await dialog.showOpenDialog({
      title: 'Импорт данных',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    let backup;
    try {
      backup = parseBackup(readFileSync(r.filePaths[0], 'utf8'));
    } catch (e: any) {
      dialog.showErrorBox('Импорт не выполнен', e?.message ?? String(e));
      return null;
    }
    // WAL-safe safety copy: checkpoint first so all committed data is in the
    // main file, then copy just that file.
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* ignore */
    }
    try {
      copyFileSync(join(app.getPath('userData'), 'library.db'), join(app.getPath('userData'), 'library.db.bak'));
    } catch {
      /* ignore */
    }

    try {
      const res = repo.importItems(backup.series ?? []);

      const prevSettings = settings.get();
      // parseSettings: a backup is external input. Unknown/garbage fields used
      // to be saved verbatim (a non-string downloads_dir crashed the dir
      // resolver AFTER series were already imported → "Импорт не выполнен"
      // with half the data applied).
      const next = parseSettings({ ...prevSettings, ...backup.settings });
      for (const k of SECRET_SETTINGS) {
        if (String((backup.settings as any)[k] ?? '') === '') (next as any)[k] = (settings.get() as any)[k];
      }
      settings.save(next);
      // Apply the imported settings at runtime and tell the renderer about
      // them. Without the broadcast the renderer kept showing (and echoing
      // back) its pre-import copy, silently reverting the import on the next
      // settings change; downloads dir / cover cache / Tor only took effect
      // after a restart.
      applyRuntimeSettings(next, prevSettings);
      deps.broadcastSettingsChanged(next);
      sync?.markSettingsChanged();
      sync?.scheduleSync();

      const accountsAdded = Array.isArray(backup.accounts) ? exAccounts.importAccounts(backup.accounts) : 0;

      let downloadsMerged = 0;
      const existing = new Set(downloads.list().map((t) => t.sourceUrl));
      for (const t of backup.downloads ?? []) {
        if (existing.has(t.sourceUrl)) continue;
        downloads.adopt(t);
        existing.add(t.sourceUrl);
        downloadsMerged++;
      }

      deps.broadcastLibraryChanged();
      const summary: BackupSummary = {
        seriesAdded: res.added,
        seriesUpdated: res.updated,
        accountsAdded,
        downloadsMerged,
      };
      return summary;
    } catch (e: any) {
      dialog.showErrorBox('Импорт не выполнен', e?.message ?? String(e));
      return null;
    }
  });

  handleSafe(CH.torDiagnostics, z.tuple([]), async () => getTorDiagnostics());
  handleSafe(CH.getSettings, z.tuple([]), () => {
    const s = settings.get();
    rememberSettingsSecrets(s);
    return s;
  });
  handleSafe(CH.setSettings, z.tuple([looseObject<Settings>()]), (e, s: Settings) => {
    // The renderer sends its full settings snapshot, which can be stale: a
    // login window may have persisted cookies into settings.json after the
    // renderer loaded its copy. Do not let the renderer's empty cookie
    // strings wipe freshly grabbed sessions. The cookie keys are derived from
    // the single SECRET_SETTINGS list (backup.ts) so the two never drift.
    const prev = settings.get();
    for (const k of [...COOKIE_SECRET_FIELDS, ...TOKEN_SECRET_FIELDS]) {
      const incoming = String(s[k] ?? '');
      const previous = String(prev[k] ?? '');
      if (incoming === '') {
        if (previous !== '') s[k] = previous;
        continue;
      }
      // The renderer echoed the snapshot we sent it, while the main process
      // has a newer session (saved by a login window). Keep the fresh one.
      if (incoming !== previous && isRendererSnapshotSecret(k, incoming)) s[k] = previous;
    }
    // Main-owned reading state. The renderer only READS read_chapters,
    // read_scroll, viewing_history and read_progress, so its (possibly stale)
    // copy must never replace the main process's — a stale echo silently
    // reverted chapter marks, scroll offsets and progress. MangaDex's series
    // marker now has its own IPC (setSeriesProgress) instead of an echoed
    // settings write, so a deliberate rollback is not mistaken for an echo.
    s.read_chapters = prev.read_chapters;
    s.read_scroll = prev.read_scroll;
    s.viewing_history = prev.viewing_history;
    s.read_progress = prev.read_progress;
    const prevSettings = prev;
    // The renderer object is untrusted input: normalise before writing it to
    // disk. A bad field (e.g. a numeric downloads_dir) used to be persisted,
    // and the next boot then threw in boot() — an invisible zombie process.
    const safe = parseSettings(s);
    try {
      settings.save(safe);
    } catch (e: any) {
      // Write failed (EPERM from AV/sync client, full disk): SettingsService has
      // already replaced `current`, so restore the previous object to keep memory
      // and disk in agreement, and report the failure.
      try {
        settings.save(prevSettings);
      } catch {
        /* best-effort rollback */
      }
      throw e;
    }
    try {
      applyRuntimeSettings(safe, prevSettings);
    } catch (e: any) {
      // Runtime side effects must not undo a successfully saved setting.
      logger.error('[settings] applyRuntimeSettings failed:', e?.message ?? e);
    }
    deps.broadcastSettingsChanged(safe, e.sender.id);
    s = safe;
    if (isPortableSettingsChanged(prevSettings, s)) {
      sync?.markSettingsChanged();
      sync?.scheduleSync();
    }
    // Turning sync on must actually schedule one: sync_enabled/sync_auto are not
    // part of the portable payload, so the old branch never fired and the UI sat
    // at "ещё не было" until the user pressed "Синхронизировать сейчас".
    if (s.sync_enabled && (!prevSettings.sync_enabled || s.sync_auto !== prevSettings.sync_auto)) {
      sync?.scheduleSync();
    }
  });

  /** read_chapters is an unbounded append-only list (one URL per chapter ever
   * read) stored in settings.json, which is rewritten on every progress tick.
   * Keep the most recent entries: older read marks are cosmetic. */
  const capReadChapters = (list: string[]): string[] => (list.length <= 4000 ? list : list.slice(list.length - 4000));

  handleSafe(CH.markChapterRead, z.tuple([anyString]), (_e, url: string) => {
    const s = settings.get();
    if (s.read_chapters.includes(url)) return;
    const next = { ...s, read_chapters: capReadChapters([...s.read_chapters, url]) };
    settings.save(next);
    // Refresh the renderer's copy too: otherwise its next settings echo would
    // carry the pre-mark list back and un-mark the chapter just finished.
    deps.broadcastSettingsChanged(next);
  });

  handleSafe(CH.setChapterRead, z.tuple([anyString, z.boolean()]), (_e, url: string, read: boolean) => {
    const s = settings.get();
    const has = s.read_chapters.includes(url);
    if (read === has) return;
    const read_chapters = capReadChapters(read ? [...s.read_chapters, url] : s.read_chapters.filter((u) => u !== url));
    const next = { ...s, read_chapters };
    settings.save(next);
    // The chapter list renders its ✓ from this snapshot — without the
    // broadcast the toggle looked like it did nothing until the modal reopened.
    deps.broadcastSettingsChanged(next);
  });

  // Explicit logout. The setSettings cookie guard restores an empty field on
  // purpose (stale-snapshot protection), so clearing the textarea never stuck —
  // this handler is the only way to drop a session.
  handleSafe(
    CH.clearSiteCookies,
    z.tuple([z.enum(['onion', 'nhentai', 'nhentai_onion', 'senkuro'])]),
    (_e, field: 'onion' | 'nhentai' | 'nhentai_onion' | 'senkuro') => {
      const key = (
        {
          onion: 'onion_cookies_raw',
          nhentai: 'nhentai_cookies_raw',
          nhentai_onion: 'nhentai_onion_cookies_raw',
          senkuro: 'senkuro_cookies_raw',
        } as const
      )[field];
      const next: Settings = { ...settings.get(), [key]: '' };
      settings.save(next);
      deps.broadcastSettingsChanged(next);
    },
  );
  handleSafe(CH.coverCacheInfo, z.tuple([]), () => deps.getCoverDisk().stats());  handleSafe(CH.coverCacheClear, z.tuple([]), async () => {
    await deps.getCoverDisk().clear();
    coverCache.clear();
  });
}
