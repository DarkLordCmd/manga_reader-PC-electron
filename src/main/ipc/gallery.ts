import { dialog, ipcMain } from 'electron';
import { z } from 'zod';
import { CH } from '@shared/ipc';
import { handleSafe, existingDirOrArchive, httpUrl, anyString, nonNegInt } from './validate';
import { UnsupportedUrlError, type GalleryResolution } from '../services/resolve-gallery';
import type { Gallery } from '../services/gallery';
import type { ZipGalleryInfo } from '../services/zip-gallery';
import { logger } from '../services/logger';
import type { SettingsService } from '../services/settings';
import type { HistoryManager } from '../services/history';
import type { LibraryService } from '../services/library';
import type { ExAccountsService } from '../services/accounts';

export interface GalleryDeps {
  settings: SettingsService;
  history: HistoryManager;
  library: LibraryService;
  exAccounts: ExAccountsService;
  effectiveTorSocks(): string;
  state: {
    galleries: Map<string, Gallery>;
    zipMeta: Map<string, { zipPath: string; entries: string[] }>;
    ZIP_TMP: string;
  };
  onlineHeaders: Map<string, Record<string, string>>;
  resolveGallery(url: string, opts: { proxy?: string; cookieHeader?: string }): Promise<GalleryResolution>;
  createOnlineGallery(title: string, urls: string[], proxy?: string): string;
  setReadingPosition(gid: string, index: number): void;
  openZipGallery(zipPath: string, tmpBase: string): Promise<ZipGalleryInfo | null>;
  galleryFromFolder(dir: string): Gallery | null;
  isZipPath(p: string): boolean;
}

export function registerGallery(deps: GalleryDeps): void {
  const {
    settings,
    history,
    library,
    exAccounts,
    effectiveTorSocks,
    state,
    onlineHeaders,
    resolveGallery,
    createOnlineGallery,
    setReadingPosition,
    openZipGallery,
    galleryFromFolder,
    isZipPath,
  } = deps;
  const { galleries, zipMeta, ZIP_TMP } = state;

  async function openFolderLocal(
    path: string,
  ): Promise<{ id: string; title: string; pageCount: number; pages: string[]; url: string } | null> {
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

  ipcMain.handle(CH.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'openFile'] });
    if (r.canceled || r.filePaths.length === 0) return null;
    return openFolderLocal(r.filePaths[0]);
  });
  handleSafe(CH.openFolder, z.tuple([existingDirOrArchive]), (_e, path) => openFolderLocal(path));
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
      // if configured, the dedicated exhentai_proxy_addr proxy. Cookies must be
      // routed per source — the onion jar must never leak onto clearnet
      // requests (and vice versa).
      const isClearnetEx = url.includes('exhentai') || url.includes('e-hentai.org');
      const cookieHeader = url.includes('.onion')
        ? s.onion_cookies_raw
        : url.includes('nhentai')
          ? s.nhentai_cookies_raw
          : url.includes('senkuro')
            ? s.senkuro_cookies_raw
            : isClearnetEx
              ? exAccounts.currentCookieHeader()
              : undefined;
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
  handleSafe(CH.setReadingPosition, z.tuple([anyString, nonNegInt]), (_e, gid: string, index: number) => {
    setReadingPosition(gid, index);
  });
  handleSafe(CH.rescanFolder, z.tuple([existingDirOrArchive]), (_e, path) => {
    const g = galleryFromFolder(path);
    if (!g) return null;
    galleries.set(g.id, g);
    return { id: g.id, title: g.title, pageCount: g.pages.length, pages: g.pages, url: `file://${path}` };
  });
}
