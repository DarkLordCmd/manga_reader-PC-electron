import { ipcMain } from 'electron';
import { CH } from '@shared/ipc';
import type { LibraryService } from '../services/library';
import type { HistoryManager } from '../services/history';
import type { SettingsService } from '../services/settings';
import type { SyncService } from '../services/sync';

export function registerLibrary(deps: {
  library: LibraryService;
  history: HistoryManager;
  settings: SettingsService;
  sync?: SyncService | null;
  broadcastLibrary: () => void;
}): void {
  const { library, history, settings, sync, broadcastLibrary } = deps;

  ipcMain.handle(CH.getHistory, () => history.toVec());

  ipcMain.handle(CH.libraryList, (_e, query) => library.list(query ?? {}));
  ipcMain.handle(CH.libraryGet, (_e, key: string) => library.get(String(key)));
  ipcMain.handle(CH.libraryAdd, (_e, entry) => {
    const item = library.addFromCatalog(entry);
    broadcastLibrary();
    return item;
  });
  ipcMain.handle(CH.libraryLookup, (_e, url: string, seriesId: string) => library.lookup(String(url), String(seriesId)));
  ipcMain.handle(CH.librarySetFavorite, (_e, key: string, at: number | null) => {
    library.setFavorite(String(key), at);
    broadcastLibrary();
  });
  ipcMain.handle(CH.libraryAddFavorite, (_e, entry) => {
    const it = library.addFavorite(entry);
    broadcastLibrary();
    return it;
  });
  ipcMain.handle(CH.librarySetStatusFor, (_e, entry, status) => {
    const it = library.setStatusFor(entry, status);
    broadcastLibrary();
    return it;
  });
  ipcMain.handle(CH.librarySetStatus, (_e, key: string, status: any) => {
    library.setStatus(String(key), status);
    broadcastLibrary();
  });
  ipcMain.handle(CH.librarySetNote, (_e, key: string, note: string) => {
    library.setNote(String(key), String(note ?? ''));
    broadcastLibrary();
  });
  ipcMain.handle(CH.librarySetRating, (_e, key: string, rating: number | null) => {
    library.setRating(String(key), rating);
    broadcastLibrary();
  });
  ipcMain.handle(CH.librarySetTags, (_e, key: string, tags: string[]) => {
    library.setTags(String(key), Array.isArray(tags) ? tags : []);
    broadcastLibrary();
  });
  ipcMain.handle(CH.libraryRemove, (_e, key: string) => {
    library.removeFromLibrary(String(key));
    broadcastLibrary();
  });
  ipcMain.handle(CH.libraryDelete, (_e, key: string) => {
    library.deleteSeries(String(key));
    broadcastLibrary();
  });
  ipcMain.handle(CH.libraryCounts, () => library.countByStatus());
  ipcMain.handle(CH.libraryStatuses, (_e, urls: string[]) => library.statusesForUrls(Array.isArray(urls) ? urls.map(String) : []));

  ipcMain.handle(CH.recordProgress, (_e, url: string, page: number, total: number) => {
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
