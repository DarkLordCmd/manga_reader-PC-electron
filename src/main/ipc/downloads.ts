import { dialog, ipcMain } from 'electron';
import { z } from 'zod';
import { CH } from '@shared/ipc';
import { handleSafe, httpUrl, dlTypeToken, idString, nonNegInt } from './validate';
import { galleryFromFolder } from '../services/gallery';
import { sourceLabel, type GalleryResolution } from '../services/resolve-gallery';
import { fetchArchiveCost, buyArchive } from '../services/eh-archive';
import { extractGidToken } from '../services/catalog-search';
import { makeDownloadFetchOpts } from '../app/http-helpers';
import { galleries } from '../app/state';
import type { DownloadManager } from '../services/download-manager';
import type { SettingsService } from '../services/settings';
import type { ExAccountsService } from '../services/accounts';

const SERIES_SOURCES = ['MangaDex', 'Remanga', 'Senkuro', 'Manga-shi', 'Readmanga', 'Mintmanga', 'Mangapoisk', 'MangaMello'];

export function registerDownloads(deps: {
  downloads: DownloadManager;
  settings: SettingsService;
  exAccounts: ExAccountsService;
  effectiveTorSocks: () => string;
  resolveGallery: (url: string, opts: { proxy?: string; cookieHeader?: string }) => Promise<GalleryResolution>;
  fetchChapterCountSafe: (mangaId: string) => Promise<number | null>;
  fetchChapterListSafe: (mangaId: string) => Promise<{ chapter_id: string; chapter_num: string; title: string | null }[] | null>;
}): void {
  const { downloads, resolveGallery } = deps;
  const downloadFetchOpts = makeDownloadFetchOpts({
    settings: () => deps.settings,
    effectiveTorSocks: deps.effectiveTorSocks,
    exAccounts: deps.exAccounts,
  });

  ipcMain.handle(CH.downloadsList, () => downloads.list());
  handleSafe(CH.downloadsAdd, z.tuple([httpUrl]), async (_e, sourceUrl) => {
    const { proxy, cookieHeader } = downloadFetchOpts(sourceUrl);
    const holder: { res: GalleryResolution | null } = { res: null };
    const task = await downloads.add(
      sourceUrl,
      async () => {
        holder.res = await resolveGallery(sourceUrl, { proxy, cookieHeader });
        return holder.res;
      },
      {
        Referer: sourceUrl,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      proxy,
    );
    if (task && holder.res) {
      const mangaId = holder.res.mangaId;
      if (mangaId && SERIES_SOURCES.includes(sourceLabel(sourceUrl))) {
        downloads.setChapterMeta(task.id, { mangaId });
        const count = await deps.fetchChapterCountSafe(mangaId);
        if (count != null) downloads.setChapterMeta(task.id, { chapterTotal: count });
      }
    }
    return task;
  });

  ipcMain.handle(CH.downloadsCheckChapters, async () => {
    const updated: string[] = [];
    for (const t of downloads.list()) {
      if (!t.mangaId || t.chapterTotal == null) continue;
      const list = await deps.fetchChapterListSafe(t.mangaId);
      if (!list) continue;
      if (list.length > t.chapterTotal) {
        downloads.setChapterMeta(t.id, {
          newChapters: list.length - t.chapterTotal,
          latestChapterId: list[list.length - 1].chapter_id,
        });
        updated.push(t.id);
      }
    }
    return updated;
  });
  handleSafe(CH.downloadsPause, z.tuple([idString]), (_e, id: string) => downloads.pause(id));
  handleSafe(CH.downloadsResume, z.tuple([idString]), (_e, id: string) => downloads.resume(id));
  handleSafe(CH.downloadsRemove, z.tuple([idString]), (_e, id: string) => downloads.remove(id));
  handleSafe(CH.downloadsSetPriority, z.tuple([idString, z.number()]), (_e, id: string, p: number) => downloads.setPriority(id, p));
  handleSafe(CH.downloadsOpen, z.tuple([idString]), (_e, id: string) => {
    const t = downloads.list().find((x) => x.id === id);
    if (!t || t.state !== 'completed') return null;
    const g = galleryFromFolder(t.outDir);
    if (!g) return null;
    galleries.set(g.id, g);
    return { id: g.id, title: g.title, pageCount: g.pages.length, pages: g.pages, url: `file://${t.outDir}` };
  });
  ipcMain.handle(CH.downloadsCheckUpdates, async () => {
    const urls = downloads
      .list()
      .filter((t) => t.state === 'completed')
      .map((t) => t.sourceUrl);
    return await downloads.checkUpdates(urls, async (url) => {
      const { proxy, cookieHeader } = downloadFetchOpts(url);
      return await resolveGallery(url, { proxy, cookieHeader });
    });
  });

  function archiverUrlFor(galleryUrl: string): string | null {
    const gt = extractGidToken(galleryUrl);
    if (!gt) return null;
    const base = new URL(galleryUrl);
    return `${base.origin}/archiver.php?gid=${gt.gid}&token=${gt.token}`;
  }
  handleSafe(CH.ehArchiveCost, z.tuple([httpUrl]), async (_e, url) => {
    const archiver = archiverUrlFor(url);
    if (!archiver) return null;
    const { proxy, cookieHeader } = downloadFetchOpts(url);
    try {
      return await fetchArchiveCost(archiver, { cookieHeader, proxy });
    } catch {
      return null;
    }
  });
  handleSafe(CH.ehArchiveBuy, z.tuple([httpUrl, dlTypeToken]), async (_e, url, dltype) => {
    const archiver = archiverUrlFor(url);
    if (!archiver) return null;
    const { proxy, cookieHeader } = downloadFetchOpts(url);
    try {
      return await buyArchive(archiver, { cookieHeader, proxy, dltype });
    } catch {
      return null;
    }
  });
  handleSafe(CH.downloadsAddArchive, z.tuple([httpUrl, z.string().min(1).max(512), httpUrl]), (_e, sourceUrl, title, downloadUrl) => {
    const { proxy, cookieHeader } = downloadFetchOpts(sourceUrl);
    return downloads.addArchive(
      sourceUrl,
      title,
      downloadUrl,
      {
        Referer: new URL(sourceUrl).origin + '/',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      proxy,
    );
  });

  ipcMain.handle(CH.downloadsPickDir, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  });
}
