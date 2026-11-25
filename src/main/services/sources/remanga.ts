import { httpGetJson } from '../http';
import { SwrCache } from '../swr-cache';
import { type CatalogItem, type CatalogFilters } from './catalog-types';

export interface ChapterInfo {
  chapter_id: string;
  chapter_num: string;
  title: string | null;
  lang: string;
}

export function mangaSeriesUrlFromChapterUrl(url: string): string | null {
  const lower = url.toLowerCase();
  const isGrouple = lower.includes('readmanga.') || lower.includes('mintmanga.') || lower.includes('mangapoisk.');
  if (lower.includes('mangamello')) {
    try {
      const u = new URL(url);
      const segs = u.pathname
        .split('/')
        .filter(Boolean)
        .map((s) => s.toLowerCase());
      const i = segs.findIndex((s) => s === 'mangas' || s === 'manga');
      if (i >= 0 && segs[i + 1]) return `https://mangamello.com/manga/${segs[i + 1]}/`;
    } catch {
      /* ignore */
    }
    return null;
  }
  if (!(lower.includes('manga-shi.') || lower.includes('remanga.') || lower.includes('senkuro.') || isGrouple)) return null;
  try {
    const u = new URL(url);
    if (isGrouple && !u.pathname.toLowerCase().split('/').includes('manga')) {
      // Grouple sites (readmanga/mintmanga/mangapoisk) use chapter URLs of the
      // form /<slug>/v<vol>[/<chapter>] — the series url is /<slug>/.
      const segs = u.pathname.split('/').filter(Boolean);
      if (segs.length === 0 || /^v\d+$/.test(segs[0]) || /^\d+$/.test(segs[0])) return null;
      const result = new URL(u);
      result.pathname = `/${segs[0]}/`;
      result.search = '';
      result.hash = '';
      return result.toString();
    }
    const segs = u.pathname.split('/').filter(Boolean);
    const i = segs.findIndex((s) => s.toLowerCase() === 'manga');
    if (i >= 0 && segs[i + 1]) {
      const result = new URL(u);
      result.pathname = `/manga/${segs[i + 1]}/`;
      result.search = '';
      result.hash = '';
      return result.toString();
    }
  } catch {
    /* ignore */
  }
  return null;
}

const searchCache = new SwrCache<CatalogItem[]>(120_000, 40);

let remangaToken = '';
let remangaCookies = '';
/** Apply the account session captured by the Remanga login window to all
 * catalogue, suggestion, chapter-list and chapter API requests. */
export function setRemangaAuth(token: string, cookies: string): void {
  remangaToken = token.trim();
  remangaCookies = cookies.trim();
}

function remangaAuthHeaders(): Record<string, string> {
  if (remangaToken) return { Authorization: `Bearer ${remangaToken}` };
  if (remangaCookies) return { Cookie: remangaCookies };
  return {};
}

function remangaAuthKey(): string {
  return remangaToken ? `token:${remangaToken.slice(-8)}` : remangaCookies ? `cookies:${remangaCookies.length}` : 'public';
}

export async function searchRemanga(query: string, page: number, filters: CatalogFilters = {}, proxy?: string): Promise<CatalogItem[]> {
  const key = ['rm', query, page, JSON.stringify(filters), remangaAuthKey()].join('|');
  return searchCache.get(key, async () => {
  // UI sends '' for the default sort — `'' || 'views'` (a nullish coalescing
  // would keep the empty string) → invalid ordering crashes the API.
  const params = new URLSearchParams({ page: String(page + 1), count: '20', ordering: filters.remangaOrdering || 'views' });
  if (query.trim()) params.set('query', query.trim());
  if (filters.remangaStatus) params.set('status', filters.remangaStatus);
  if (filters.remangaTypes) params.set('types', filters.remangaTypes);
  for (const g of filters.remangaGenres ?? []) params.append('genres', g);
  for (const c of filters.remangaCategories ?? []) params.append('categories', c);
  const json = (await httpGetJson(
    `https://api.remanga.org/api/v2/search/catalog/?${params.toString()}`,
    {
      Referer: 'https://remanga.org/',
      Accept: 'application/json',
      ...remangaAuthHeaders(),
    },
    proxy,
  )) as any;
  const results: any[] = json?.results ?? json?.content ?? [];
  // API now returns cover paths without a host (/media/titles/...).
  const coverOf = (r: any): string | null => {
    const c = r?.cover?.high ?? r?.cover?.mid ?? null;
    if (typeof c !== 'string' || !c) return null;
    return c.startsWith('http') ? c : `https://remanga.org${c.startsWith('/') ? '' : '/'}${c}`;
  };
  return results.map((r) => ({
    url: `https://remanga.org/manga/${r?.dir ?? ''}/`,
    title: r?.main_name ?? r?.rus_name ?? r?.name ?? 'Без названия',
    coverUrl: coverOf(r),
    // count_chapters is a chapter count, not a page count: the card renders
    // `pages` as "N стр." and showed "612 стр." for a 2-page chapter.
    pages: null,
    chapterCount: typeof r?.count_chapters === 'number' ? r.count_chapters : null,
    kind: r?.type?.name ?? null,
    score: typeof r?.avg_rating === 'number' ? r.avg_rating : null,
    // Remanga flags adult/forbidden titles with is_forbidden.
    adult: r?.is_forbidden === true,
    // Remanga search returns genres/categories with the card — surface them as
    // tags instead of dropping them.
    tags: [
      ...new Set(
        [...(Array.isArray(r?.genres) ? r.genres : []), ...(Array.isArray(r?.categories) ? r.categories : [])]
          .map((g: any) => (typeof g?.name === 'string' ? g.name : null))
          .filter((n: string | null): n is string => !!n),
      ),
    ].slice(0, 40),
  }));
  });
}

const REMANGA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
// 50 chapters per page: allow up to 10,000 chapters without unbounded pagination.
const MAX_REMANGA_CHAPTER_PAGES = 200;

export async function fetchRemangaChapters(mangaUrl: string, proxy?: string): Promise<ChapterInfo[]> {
  const dir = mangaUrl.trim().replace(/\/+$/, '').split('/').pop() ?? '';
  if (!dir) throw new Error('Не удалось определить директорию тайтла');

  const titleJson = (await httpGetJson(
    `https://remanga.org/api/v2/titles/${dir}/`,
    {
      Referer: 'https://remanga.org/',
      Accept: 'application/json',
      ...remangaAuthHeaders(),
    },
    proxy,
  )) as any;
  const mainName: string = titleJson?.main_name ?? '';
  const branchId: number = titleJson?.branches?.[0]?.id ?? 0;
  if (!branchId) throw new Error('Remanga: не удалось определить ID ветки');

  const all: { id: number; index: number; chapter: string; name: string | null }[] = [];
  for (let page = 1; ; page++) {
    const q = new URLSearchParams({
      branch_id: String(branchId),
      ordering: '-index',
      count: '50',
      page: String(page),
      is_published: '1',
      detail: '1',
    });
    const json = (await httpGetJson(
      `https://api.remanga.org/api/v2/titles/chapters/?${q.toString()}`,
      {
        Referer: 'https://remanga.org/',
        Accept: 'application/json',
        ...remangaAuthHeaders(),
      },
      proxy,
    )) as any;
    const results: any[] = json?.results ?? [];
    if (results.length === 0) break;
    for (const ch of results) {
      all.push({
        id: ch?.id ?? 0,
        index: ch?.index ?? 0,
        chapter: ch?.chapter ?? '',
        name: typeof ch?.name === 'string' && ch.name ? ch.name : null,
      });
    }
    if (typeof json?.next !== 'number' && !json?.next) break;
    if (page >= MAX_REMANGA_CHAPTER_PAGES) {
      throw new Error(`Remanga: превышен лимит пагинации глав (${MAX_REMANGA_CHAPTER_PAGES} страниц); список может быть неполным`);
    }
  }

  if (all.length === 0) throw new Error('Remanga: список глав недоступен');
  all.sort((a, b) => a.index - b.index);
  return all.map((c) => ({
    chapter_id: `https://remanga.org/manga/${dir}/${c.id}/`,
    chapter_num: c.chapter,
    title: c.name ?? (mainName ? mainName : null),
    lang: 'remanga',
  }));
}

export async function fetchRemangaChapter(chapterUrl: string, proxy?: string): Promise<{ title: string; pageUrls: string[] }> {
  const parts = chapterUrl.trim().replace(/\/+$/, '').split('/');
  const chapterId = parts.pop() ?? '';
  if (!chapterId) throw new Error('Не удалось определить ID главы');

  const json = (await httpGetJson(
    `https://api.remanga.org/api/v2/titles/chapters/${chapterId}/`,
    {
      Referer: 'https://remanga.org/',
      Accept: 'application/json',
      ...remangaAuthHeaders(),
    },
    proxy,
  )) as any;

  const chapterNum: string = json?.chapter ?? '?';
  const chapterName: string = typeof json?.name === 'string' ? json.name : '';
  const title = chapterName ? `Remanga: Глава ${chapterNum} — ${chapterName}` : `Remanga: Глава ${chapterNum}`;

  const raw: string[] = [];
  const spreads: any[] = json?.pages ?? [];
  for (const spread of spreads) {
    if (Array.isArray(spread)) {
      for (const page of spread) {
        if (typeof page?.link === 'string') raw.push(page.link);
      }
    }
  }

  const pageNum = (u: string): number => {
    const fn = u.split('/').pop() ?? '';
    const m = fn.match(/^\d+/);
    return m ? Number(m[0]) : 0;
  };
  raw.sort((a, b) => pageNum(a) - pageNum(b));
  if (raw.length === 0) throw new Error('Remanga: глава не содержит страниц');
  return { title, pageUrls: raw };
}
