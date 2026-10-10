import { app, dialog, ipcMain } from 'electron';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { CH } from '@shared/ipc';
import type { BackupSummary } from '@shared/ipc';
import type { Settings } from '@shared/settings';
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
import { setTorFallbackAddr } from '../services/http';
import { setLibMirror } from '../services/lib-mirror';
import { setCustomDnsServers, parseDnsServerList } from '../services/custom-dns';
import { startEmbeddedTor, stopEmbeddedTor, embeddedTorSocks } from '../services/tor-embedded';
import { setCoverDiskMaxBytes } from '../app/state';

/** Secret settings that are session/`.onion` cookies — the renderer's stale
 * snapshot must never blank them. Derived from SECRET_SETTINGS so the set of
 * cookie secrets stays in one place. */
type CookieSecretField = Extract<(typeof SECRET_SETTINGS)[number], `${string}_cookies_raw`>;
const COOKIE_SECRET_FIELDS = SECRET_SETTINGS.filter((k) => k.endsWith('_cookies_raw')) as CookieSecretField[];

export function registerSettings(deps: {
  settings: SettingsService;
  sync?: SyncService | null;
  repo: SqliteSeriesRepository;
  exAccounts: ExAccountsService;
  downloads: DownloadManager;
  db: { pragma(sql: string): unknown };
  coverCache: Map<string, Buffer>;
  getCoverDisk: () => CoverDiskCache;
  broadcastSettingsChanged: (s: Settings) => void;
  broadcastLibraryChanged: () => void;
  effectiveTorSocks: () => string;
  downloadsDirBase: (dir: string | null | undefined) => string;
}): void {
  const { settings, sync, repo, exAccounts, downloads, db, coverCache } = deps;

  handleSafe(CH.backupExport, z.tuple([z.boolean()]), async (_e, includeSecrets: boolean) => {
    const r = await dialog.showSaveDialog({
      title: 'Экспорт данных',
      defaultPath: `manga-reader-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    const data = buildBackup(settings.get(), repo.all(), exAccounts.accounts, downloads.list(), !!includeSecrets);
    writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf8');
    return { canceled: false, path: r.filePath };
  });

  ipcMain.handle(CH.backupImport, async () => {
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

      const next = { ...settings.get(), ...backup.settings };
      for (const k of SECRET_SETTINGS) {
        if (String((backup.settings as any)[k] ?? '') === '') (next as any)[k] = (settings.get() as any)[k];
      }
      settings.save(next);
      setFrontingEnabled(!!next.enable_domain_fronting);
      setLibMirror(next.lib_image_server ?? null);
      setCustomDnsServers(parseDnsServerList(next.custom_dns ?? ''));

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

  ipcMain.handle(CH.getSettings, () => settings.get());
  handleSafe(CH.setSettings, z.tuple([looseObject<Settings>()]), (_e, s: Settings) => {
    setFrontingEnabled(!!s?.enable_domain_fronting);
    setTorFallbackAddr(deps.effectiveTorSocks());
    setLibMirror(s?.lib_image_server ?? null);
    setCustomDnsServers(parseDnsServerList(s?.custom_dns ?? ''));
    // Bundled Tor daemon lifecycle follows the toggle at runtime.
    if (!!s?.builtin_tor && !embeddedTorSocks()) {
      void startEmbeddedTor(s?.tor_bridges ?? '', app.getPath('userData')).then((r) => {
        if (r) setTorFallbackAddr(deps.effectiveTorSocks());
      });
    } else if (!s?.builtin_tor && embeddedTorSocks()) {
      stopEmbeddedTor();
      setTorFallbackAddr(deps.effectiveTorSocks());
    }
    // The renderer sends its full settings snapshot, which can be stale: a
    // login window may have persisted cookies into settings.json after the
    // renderer loaded its copy. Do not let the renderer's empty cookie
    // strings wipe freshly grabbed sessions. The cookie keys are derived from
    // the single SECRET_SETTINGS list (backup.ts) so the two never drift.
    const prev = settings.get();
    for (const k of COOKIE_SECRET_FIELDS) {
      if (String(s[k] ?? '') === '' && String(prev[k] ?? '') !== '') s[k] = prev[k];
    }
    const prevSettings = settings.get();
    const before = deps.downloadsDirBase(prevSettings.downloads_dir);
    settings.save(s);
    setCoverDiskMaxBytes(Math.max(16, Number(s?.cover_cache_mb) || 256) * 1024 * 1024);
    const after = deps.downloadsDirBase(s?.downloads_dir);
    if (before !== after) downloads.setOutDirBase(after);
    deps.broadcastSettingsChanged(s);
    if (isPortableSettingsChanged(prevSettings, s)) {
      sync?.markSettingsChanged();
      sync?.scheduleSync();
    }
  });

  handleSafe(CH.markChapterRead, z.tuple([anyString]), (_e, url: string) => {
    const s = settings.get();
    if (!s.read_chapters.includes(url)) {
      settings.save({ ...s, read_chapters: [...s.read_chapters, url] });
    }
  });

  ipcMain.handle(CH.coverCacheInfo, () => deps.getCoverDisk().stats());
  ipcMain.handle(CH.coverCacheClear, async () => {
    await deps.getCoverDisk().clear();
    coverCache.clear();
  });
}
