import { resolveAtHome } from './mangadex';
import { fetchRemangaChapter, fetchSenkuroChapter, mangaSeriesUrlFromChapterUrl, senkuroSeriesUrlFromChapterUrl } from './sources';
import { fetchSimpleGallery } from './simple-gallery';
import { fetchMangaMelloChapter } from './sources';
import * as cheerio from 'cheerio';

/** image hosts used by com-x reader pages (window.__IMG_HOST__ may pick one
 * depending on the visitor's timezone). */
export const CGI_IMAGE_HOSTS = /(?:img\.com-x\.life\/comix\/|rus\.com-x\.life\/comix\/)/;

// Resolved fields (title, pageUrls, coverUrl, source, referer, mangaId, seriesId) mirror the
// former inline openUrl routing in src/main/index.ts so behavior stays byte-identical.
export interface GalleryResolution {
  title: string;
  /** Chapter label when the source hands it over separately (Senkuro: the
   * chapter node has only a number; the title is the work name). */
  chapterLabel?: string | null;
  pageUrls: string[];
  coverUrl: string | null;
  source: string;
  referer: string | null;
  mangaId: string | null;
  seriesId: string;
  proxy?: string;
}

export class UnsupportedUrlError extends Error {
  constructor() {
    super('Неподдерживаемый URL');
  }
}

function isUuid(s: string): boolean {
  return s.length === 36 && [...s].every((c, i) => (i === 8 || i === 13 || i === 18 || i === 23 ? c === '-' : /[0-9a-fA-F]/.test(c)));
}

export function extractMangaDexChapterId(url: string): string | null {
  const t = url.trim();
  if (t.includes('mangadex.org')) {
    const pos = t.indexOf('/chapter/');
    if (pos >= 0) {
      const seg = t.slice(pos + '/chapter/'.length).split('/')[0];
      if (seg) return seg;
    }
  }
  if (isUuid(t)) return t;
  return null;
}

export function sourceLabel(url: string): string {
  const l = url.toLowerCase();
  if (l.includes('mangadex')) return 'MangaDex';
  if (l.includes('exhentai')) return 'ExHentai';
  if (l.includes('e-hentai.org')) return 'E-Hentai';
  if (l.includes('nhentai')) return 'NHentai';
  if (l.includes('com-x.life')) return 'Com-X';
  if (l.includes('senkuro')) return 'Senkuro';
  if (l.includes('manga-shi')) return 'Manga-shi';
  if (l.includes('remanga')) return 'Remanga';
  if (l.includes('hentailib')) return 'HentaiLIB';
  if (l.includes('mangalib')) return 'Mangalib';
  if (l.includes('readmanga')) return 'Readmanga';
  if (l.includes('mintmanga')) return 'Mintmanga';
  if (l.includes('mangapoisk')) return 'Mangapoisk';
  if (l.includes('mangamello')) return 'MangaMello';
  return '';
}

export async function resolveGallery(url: string, opts: { proxy?: string; cookieHeader?: string }): Promise<GalleryResolution> {
  const trimmed = url.trim();
  const seriesId = mangaSeriesUrlFromChapterUrl(trimmed) ?? trimmed;
  const chapterId = extractMangaDexChapterId(trimmed);
  if (chapterId) {
    const atHome = await resolveAtHome(chapterId);
    const pageUrls = atHome.files.map((f) => `${atHome.baseUrl}/data/${atHome.hash}/${f}`);
    return {
      title: `MangaDex Chapter ${chapterId}`,
      pageUrls,
      coverUrl: null,
      source: 'MangaDex',
      referer: 'https://mangadex.org/',
      mangaId: seriesId,
      seriesId,
    };
  }
  if (trimmed.includes('remanga.org/manga/')) {
    const r = await fetchRemangaChapter(trimmed, opts.proxy);
    return {
      title: r.title,
      pageUrls: r.pageUrls,
      coverUrl: null,
      source: 'Remanga',
      referer: 'https://remanga.org/',
      proxy: opts.proxy,
      mangaId: seriesId,
      seriesId,
    };
  }
  if (trimmed.includes('senkuro') && /\/chapters?\//.test(trimmed)) {
    const r = await fetchSenkuroChapter(trimmed, opts.cookieHeader ?? '', opts.proxy);
    return {
      title: r.title,
      chapterLabel: r.chapterLabel,
      pageUrls: r.pageUrls,
      coverUrl: null,
      source: 'Senkuro',
      referer: `${r.base}/`,
      proxy: opts.proxy,
      // Series (manga) URL, not the chapter URL: the chapter list needs the
      // manga slug, otherwise the library row breaks with "не удалось определить ветку".
      mangaId: senkuroSeriesUrlFromChapterUrl(trimmed) ?? seriesId,
      seriesId: senkuroSeriesUrlFromChapterUrl(trimmed) ?? seriesId,
    };
  }
  if (trimmed.includes('mangamello')) {
    const r = await fetchMangaMelloChapter(trimmed, opts.proxy);
    return {
      title: r.title,
      pageUrls: r.pageUrls,
      coverUrl: null,
      source: 'MangaMello',
      referer: 'https://mangamello.com/',
      proxy: opts.proxy,
      mangaId: seriesId,
      seriesId,
    };
  }
  if ((trimmed.includes('mangalib.') || trimmed.includes('hentailib.')) && /\/read\/v/i.test(trimmed)) {
    const { mangalibChapterPages } = await import('./sources/mangalib');
    const isHentai = trimmed.includes('hentailib.');
    const u = new URL(trimmed);
    const segs = u.pathname.split('/').filter(Boolean);
    const idx = segs.indexOf('read');
    // /<slug>/read/v<V>/c<C>  |  /ru/<slug>/read/v<V>/c<C>
    const slug = segs[idx - 1];
    const vol = (segs[idx + 1] ?? '').replace(/^v/i, '');
    const num = (segs[idx + 2] ?? '').replace(/^c/i, '');
    if (!slug || !vol || !num) throw new UnsupportedUrlError();
    const r = await mangalibChapterPages(slug, vol, num, opts.proxy, isHentai ? 2 : 1);
    return {
      title: r.title,
      pageUrls: r.pageUrls,
      coverUrl: null,
      source: isHentai ? 'HentaiLIB' : 'Mangalib',
      referer: isHentai ? 'https://hentailib.me/' : 'https://mangalib.me/',
      proxy: opts.proxy,
      mangaId: seriesId,
      seriesId,
    };
  }
  if (
    trimmed.includes('manga-shi.') ||
    trimmed.includes('nhentai') ||
    trimmed.includes('com-x.life') ||
    trimmed.includes('mangalib.') ||
    trimmed.includes('hentailib.') ||
    trimmed.includes('e-hentai.org') ||
    trimmed.includes('exhentai') ||
    trimmed.includes('readmanga.') ||
    trimmed.includes('mintmanga.') ||
    trimmed.includes('mangapoisk.')
  ) {
    if (trimmed.includes('third-party')) {
      // reserved for future js-only sources
    }
    if (trimmed.includes('com-x.life/reader/')) {
      // the com-x reader is a JS SPA — render through the hidden browser
      // channel and harvest the gallery <img>s.
      const { fetchHtmlViaBrowser } = await import('./browser-fetch');
      const rendered = await fetchHtmlViaBrowser(trimmed, { timeoutMs: 60_000, proxy: opts.proxy });
      const $rd = cheerio.load(rendered);
      const pages: string[] = [];
      const seen = new Set<string>();
      $rd('img[src]').each((_i, el) => {
        const s = $rd(el).attr('src') ?? '';
        if (!CGI_IMAGE_HOSTS.test(s) || s.startsWith('data:')) return;
        if (seen.has(s)) return;
        seen.add(s);
        pages.push(s);
      });
      // fallback: embedded URLs anywhere in the rendered html
      if (pages.length === 0) {
        for (const m of rendered.matchAll(/https?:\/\/img\.com-x\.life\/comix\/\d+\/\d+\/[\w._-]+\.(?:jpg|jpeg|png|webp)/g)) {
          if (!seen.has(m[0])) {
            seen.add(m[0]);
            pages.push(m[0]);
          }
        }
      }
      const title = ($rd('title').first().text().trim() || 'Com-X').slice(0, 120);
      // An empty list used to become a "completed 0/0" download that cannot be
      // opened; fail here so the task lands in error with a readable message.
      if (pages.length === 0) throw new Error('Com-X: страницы главы не найдены (сайт изменил вёрстку или глава недоступна)');
      return { title, pageUrls: pages, coverUrl: null, source: 'Com-X', referer: trimmed, proxy: opts.proxy, mangaId: seriesId, seriesId };
    }
    const g = await fetchSimpleGallery(trimmed, { proxy: opts.proxy, cookieHeader: opts.cookieHeader });
    return {
      title: g.title,
      pageUrls: g.pageUrls,
      coverUrl: g.coverUrl,
      source: sourceLabel(trimmed),
      referer: trimmed,
      proxy: opts.proxy,
      mangaId: seriesId,
      seriesId,
    };
  }
  throw new UnsupportedUrlError();
}
