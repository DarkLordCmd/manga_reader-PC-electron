import { ipcMain } from 'electron';
import { z } from 'zod';
import { CH } from '@shared/ipc';
import { READING_STATUSES, type LibraryQuery, type ReadingStatus } from '@shared/library';
import type { Settings } from '@shared/settings';
import { handleSafe, anyString, nonNegInt, stringArray } from './validate';
import type { LibraryService } from '../services/library';
import type { HistoryManager } from '../services/history';
import type { SettingsService } from '../services/settings';
import type { SyncService } from '../services/sync';

const libraryEntry = z.object({
  url: anyString,
  title: anyString,
  coverUrl: z.string().nullable(),
  source: anyString,
  seriesId: anyString,
  category: anyString.optional(),
  kind: z.string().nullable().optional(),
  adult: z.boolean().optional(),
});
const readingStatus = z.enum(READING_STATUSES);
const libraryQuery = z.object({
  status: z.enum([...READING_STATUSES, 'all']).optional(),
  search: anyString.optional(),
  sort: z.enum(['last_read', 'title', 'rating', 'added']).optional(),
  includeR34: z.boolean().optional(),
  category: anyString.optional(),
  scope: z.enum(['library', 'favorites']).optional(),
});

/** Upper bound for the main-owned per-URL maps (read_progress / read_scroll).
 * They used to grow forever — one key per chapter ever read — and every ~5 s
 * progress flush serialises the WHOLE settings.json synchronously in the main
 * process. Old resume points are dropped; history/library rows keep the state. */
const PROGRESS_MAP_LIMIT = 1000;
function capProgressMap<T>(map: Record<string, T>): Record<string, T> {
  const keys = Object.keys(map);
  if (keys.length <= PROGRESS_MAP_LIMIT) return map;
  const out: Record<string, T> = {};
  for (const k of keys.slice(keys.length - PROGRESS_MAP_LIMIT)) out[k] = map[k];
  return out;
}

export function registerLibrary(deps: {
  library: LibraryService;
  history: HistoryManager;
  settings: SettingsService;
  sync?: SyncService | null;
  broadcastLibrary: () => void;
}): void {
  const { library, history, settings, sync, broadcastLibrary } = deps;

  handleSafe(CH.getHistory, z.tuple([]), () => history.toVec());

  handleSafe(CH.libraryList, z.tuple([libraryQuery.optional()]), (_e, query?: LibraryQuery) => library.list(query ?? {}));
  handleSafe(CH.libraryGet, z.tuple([anyString]), (_e, key: string) => library.get(String(key)));
  handleSafe(CH.libraryAdd, z.tuple([libraryEntry.extend({})]), (_e, entry) => {
    const item = library.addFromCatalog(entry);
    broadcastLibrary();
    return item;
  });
  handleSafe(CH.libraryLookup, z.tuple([anyString, anyString]), (_e, url: string, seriesId: string) =>
    library.lookup(String(url), String(seriesId)),
  );
  handleSafe(CH.librarySetFavorite, z.tuple([anyString, z.number().int().nullable()]), (_e, key: string, at: number | null) => {
    library.setFavorite(String(key), at);
    broadcastLibrary();
  });
  handleSafe(CH.libraryAddFavorite, z.tuple([libraryEntry.extend({})]), (_e, entry) => {
    const it = library.addFavorite(entry);
    broadcastLibrary();
    return it;
  });
  handleSafe(CH.librarySetStatusFor, z.tuple([libraryEntry.extend({}), readingStatus]), (_e, entry, status: ReadingStatus) => {
    const it = library.setStatusFor(entry, status);
    broadcastLibrary();
    return it;
  });
  handleSafe(
    CH.librarySetStatus,
    z.tuple([anyString, readingStatus.nullable()]),
    (_e, key: string, status: ReadingStatus | null) => {
      library.setStatus(String(key), status);
      broadcastLibrary();
    },
  );
  handleSafe(CH.librarySetNote, z.tuple([anyString, anyString]), (_e, key: string, note: string) => {
    library.setNote(String(key), String(note ?? ''));
    broadcastLibrary();
  });
  handleSafe(CH.librarySetRating, z.tuple([anyString, z.number().nullable()]), (_e, key: string, rating: number | null) => {
    library.setRating(String(key), rating);
    broadcastLibrary();
  });
  handleSafe(CH.librarySetTags, z.tuple([anyString, stringArray]), (_e, key: string, tags: string[]) => {
    library.setTags(String(key), Array.isArray(tags) ? tags : []);
    broadcastLibrary();
  });
  handleSafe(CH.libraryRemove, z.tuple([anyString]), (_e, key: string) => {
    library.removeFromLibrary(String(key));
    broadcastLibrary();
  });
  handleSafe(CH.libraryDelete, z.tuple([anyString]), (_e, key: string) => {
    library.deleteSeries(String(key));
    broadcastLibrary();
  });
  handleSafe(CH.libraryCounts, z.tuple([]), () => library.countByStatus());
  handleSafe(CH.libraryStatuses, z.tuple([stringArray]), (_e, urls: string[]) =>
    library.statusesForUrls(Array.isArray(urls) ? urls.map(String) : []),
  );

  handleSafe(
    CH.recordProgress,
    z.tuple([anyString, nonNegInt, nonNegInt, z.number().min(0).optional()]),
    (_e, url: string, page: number, total: number, offset?: number) => {
      history.updateProgress(url, page, total);
      const s = settings.get();
      // Mirror into read_progress too — startPageFor() reads it when the user
      // re-open through the chapters list / URL bar, not through history.
      const rp = capProgressMap({ ...s.read_progress, [url]: [page, total] as [number, number] });
      // NOT viewing_history: that was a full copy of the DB history (78 KB of a
      // 149 KB settings.json for a normal user) rewritten on every 5-second
      // progress flush. The DB is the source of truth; the settings copy is only
      // a legacy migration source read at boot.
      const saved: Record<string, unknown> = { ...s, read_progress: rp };
      // Keep the vertical offset inside a tall webtoon page (px) so resuming
      // lands where the reader left off instead of at the page's top.
      if (typeof offset === 'number' && offset >= 0) {
        saved.read_scroll = capProgressMap({ ...s.read_scroll, [url]: offset });
      }
      settings.save(saved as unknown as Settings);
      sync?.scheduleSync();
    },
  );
  handleSafe(CH.clearHistory, z.tuple([]), () => {
    history.clear();
    settings.save({ ...settings.get(), viewing_history: [] });
    sync?.scheduleSync();
  });
}
