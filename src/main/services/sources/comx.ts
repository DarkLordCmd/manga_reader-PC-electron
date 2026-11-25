import * as cheerio from 'cheerio';
import { comxFetchText, cookieForHost } from '../comx-gate';
import { fetchHtmlViaBrowser } from '../browser-fetch';
import { type ChapterInfo } from './remanga';
import { type CatalogItem, type SimpleSiteConfig } from './catalog-types';

/** Com-X dedicated: DLE CMS markup + /reader/<news>/<chapter> pages and a
 * custom PoW challenge — everything routed through PoW-gate. The chapter
 * list is rendered client-side, so it's collected through the hidden
 * BrowserWindow channel. */

export const COMX_BASE = 'https://com-x.life';

/** Catalog: DLE listing block (`.readed*` classes), pages at /comix-read/page/N/. */
export function parseComxListing(html: string, base: string): CatalogItem[] {
  const $ = cheerio.load(html);
  const results: CatalogItem[] = [];
  const seen = new Set<string>();
  $('div.readed').each((_i, block) => {
    const href = $(block).find('a.readed__img').attr('href') ?? $(block).find('.readed__title a').attr('href');
    if (!href || !/\d+-[\w-]+\.html$/.test(href)) return;
    const full = new URL(href.startsWith('http') ? href : new URL(href, base).toString()).toString();
    if (seen.has(full)) return;
    const title = $(block).find('.readed__title a').first().text().trim();
    if (title.length < 2) return;
    seen.add(full);
    const rawCover = $(block).find('a.readed__img img').attr('data-src') ?? $(block).find('a.readed__img img').attr('src') ?? '';
    const cover = rawCover?.startsWith('http') ? rawCover : rawCover ? new URL(rawCover, base).toString() : null;
    results.push({ url: full, title, coverUrl: cover, pages: null });
  });
  return results;
}

export async function searchComx(
  _cfg: SimpleSiteConfig,
  query: string,
  page = 0,
  opts: {
    proxy?: string;
    category?: string;
    genre?: string;
    genres?: string[];
    excludeGenres?: string[];
    types?: string[];
    statuses?: string[];
    ages?: string[];
    yearFrom?: string;
    yearTo?: string;
    hideMine?: boolean;
  } = {},
): Promise<CatalogItem[]> {
  const cat = (opts.category ?? '').trim();
  const genres = (opts.genres ?? []).filter(Boolean);
  const excludeGenres = (opts.excludeGenres ?? []).filter(Boolean);
  const types = (opts.types ?? []).filter(Boolean);
  const statuses = (opts.statuses ?? []).filter(Boolean);
  const ages = (opts.ages ?? []).filter(Boolean);
  const yearFrom = (opts.yearFrom ?? '').trim();
  const yearTo = (opts.yearTo ?? '').trim();
  const hasFilters =
    !!cat || genres.length > 0 || excludeGenres.length > 0 || types.length > 0 || statuses.length > 0 || ages.length > 0 || !!yearFrom || !!yearTo || opts.hideMine === true;
  let target: string;
  if (query.trim()) {
    // DLE pagination also applies to the search listing: without page/N every
    // "След." request returned page 1 again.
    const p = page > 0 ? `page/${page + 1}/` : '';
    target = `${COMX_BASE}/search/${encodeURIComponent(query.trim())}/${p}`;
  } else if (hasFilters) {
    // The site's own xfilter builds /ComicList/<field>=<ids>/…/.
    const parts: string[] = [];
    if (cat) parts.push(`p.cat=${encodeURIComponent(cat)}`);
    if (genres.length) parts.push(`g=${genres.map(encodeURIComponent).join(',')}`);
    if (excludeGenres.length) parts.push(`exc_g=${excludeGenres.map(encodeURIComponent).join(',')}`);
    if (types.length) parts.push(`t=${types.map(encodeURIComponent).join(',')}`);
    if (statuses.length) parts.push(`st=${statuses.map(encodeURIComponent).join(',')}`);
    if (ages.length) parts.push(`adult=${ages.map(encodeURIComponent).join(',')}`);
    if (yearFrom) parts.push(`y[from]=${encodeURIComponent(yearFrom)}`);
    if (yearTo) parts.push(`y[to]=${encodeURIComponent(yearTo)}`);
    if (opts.hideMine) parts.push('mine=1');
    if (page > 0) parts.push(`page/${page + 1}`);
    target = `${COMX_BASE}/ComicList/${parts.join('/')}/`;
  } else if (cat) {
    const p = page > 0 ? `page/${page + 1}/` : '';
    target = `${COMX_BASE}/comix-read/${cat}/${p}`;
  } else {
    target = page > 0 ? `${COMX_BASE}/comix-read/page/${page + 1}/` : `${COMX_BASE}/comix-read/`;
  }
  const html = await comxFetchText(target, { proxy: opts.proxy, timeoutMs: 30_000 });
  const results = parseComxListing(html, COMX_BASE);
  return results;
}

/**
 * Chapter list is rendered client-side by their SPA — collect it through the
 * hidden BrowserWindow channel (JS runs, images stay disabled in prefs).
 * Chapters are sorted ascending by their chapter ids (their ids grow).
 */
export async function fetchComxChapters(mangaUrl: string, proxy?: string): Promise<ChapterInfo[]> {
  const host = new URL(mangaUrl).hostname;
  const html = await fetchHtmlViaBrowser(mangaUrl, {
    timeoutMs: 60_000,
    proxy,
    cookie: cookieForHost(host),
    cookieHost: host,
  });
  const $ = cheerio.load(html);
  const out: ChapterInfo[] = [];
  const seen = new Set<string>();
  $('a[href*="/reader/"]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const m = href.match(/\/reader\/(\d+)\/(\d+)/);
    if (!m) return;
    const full = href.startsWith('http') ? href : new URL(href, COMX_BASE).toString();
    if (seen.has(full)) return;
    seen.add(full);
    const rawLabel = $(el).text().trim().replace(/\s+/g, ' ');
    const label = /Том|Глава|Вып/i.test(rawLabel) ? rawLabel : `Глава ${m[2]}`;
    out.push({ chapter_id: full, chapter_num: label, title: null, lang: 'comx' });
  });
  if (out.length === 0) throw new Error('Com-X: список глав не отрендерился (возможно, анти-бот сменил разметку)');
  out.sort((a, b) => chapterNumber(a.chapter_id) - chapterNumber(b.chapter_id));
  return out;
}

/** Chapter number from a /reader/<news>/<number> URL. The old comparator used
 * `Number(chapter_id.split('/').pop())`, which is `'1.html'` → NaN: the compare
 * function returned NaN, the sort did nothing, and the list stayed descending
 * (auto-advance then walked BACKWARDS through chapters). */
function chapterNumber(chapterId: string): number {
  const m = chapterId.match(/\/reader\/\d+\/(\d+)/);
  return m ? Number(m[1]) : 0;
}
