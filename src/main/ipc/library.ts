import { ipcMain } from 'electron';
import { z } from 'zod';
import { CH } from '@shared/ipc';
import type { LibraryQuery, ReadingStatus } from '@shared/library';
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
});

export function registerLibrary(deps: {
  library: LibraryService;
  history: HistoryManager;
  settings: SettingsService;
  sync?: SyncService | null;
  broadcastLibrary: () => void;
}): void {
  const { library, history, settings, sync, broadcastLibrary } = deps;

  ipcMain.handle(CH.getHistory, () => history.toVec());

  handleSafe(CH.libraryList, z.tuple([z.custom<LibraryQuery>().optional()]), (_e, query?: LibraryQuery) => library.list(query ?? {}));
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
  handleSafe(CH.librarySetStatusFor, z.tuple([libraryEntry.extend({}), z.custom<ReadingStatus>()]), (_e, entry, status: ReadingStatus) => {
    const it = library.setStatusFor(entry, status);
    broadcastLibrary();
    return it;
  });
  handleSafe(
    CH.librarySetStatus,
    z.tuple([anyString, z.custom<ReadingStatus>().nullable()]),
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
  ipcMain.handle(CH.libraryCounts, () => library.countByStatus());
  handleSafe(CH.libraryStatuses, z.tuple([stringArray]), (_e, urls: string[]) =>
    library.statusesForUrls(Array.isArray(urls) ? urls.map(String) : []),
  );

  handleSafe(CH.recordProgress, z.tuple([anyString, nonNegInt, nonNegInt]), (_e, url: string, page: number, total: number) => {
    history.updateProgress(url, page, total);
    const s = settings.get();
    // Mirror into read_progress too — startPageFor() reads it when the user
    // re-open through the chapters list / URL bar, not through history.
    const rp = { ...s.read_progress, [url]: [page, total] as [number, number] };
    settings.save({ ...s, viewing_history: history.toVec(), read_progress: rp });
    sync?.scheduleSync();
  });
  ipcMain.handle(CH.clearHistory, () => {
    history.clear();
    settings.save({ ...settings.get(), viewing_history: [] });
    sync?.scheduleSync();
  });
}
