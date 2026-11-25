import { httpFetch } from '../http';
import { isValidDecimal } from '@shared/filters';
import { type CatalogFilters, type CatalogItem } from './catalog-types';

// Mangalib's SPA talks to a shared lib.social JSON API on api.cdnlibs.org.
// The API silently returns empty lists for requests without DDoS-Guard
// cookies, so every client first "visits" mangalib.me to collect the
// __ddg*/XSRF/session cookies and then sends them along with Site-Id: 1.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const API_BASE = 'https://api.cdnlibs.org/api';
const SITE_ID = '1';
export const MANGALIB_BASE = 'https://mangalib.me';
export const HENTAILIB_BASE = 'https://hentailib.me';

function libBase(siteId: number): string {
  return siteId === 2 ? HENTAILIB_BASE : MANGALIB_BASE;
}

interface Jar {
  cookies: string;
  ts: number;
}

let jar: Jar | null = null;
let userCookies = '';
/** Auth cookies captured by the Mangalib login window (merged with the DDoS jar). */
export function setMangalibUserCookies(value: string): void {
  userCookies = value.trim();
}
const JAR_TTL = 30 * 60_000;

function collectCookies(setCookies: string[]): string[] {
  return setCookies.map((c) => c.split(';')[0]).filter(Boolean);
}

/** Visits mangalib.me once to pick up DDoS-Guard cookies for API calls. */
async function primeCookieJar(proxy?: string): Promise<Jar> {
  if (jar && Date.now() - jar.ts < JAR_TTL) return jar;
  const r = await httpFetch(
    {
      url: 'https://mangalib.me/',
      headers: { 'User-Agent': UA, Accept: 'text/html', ...(userCookies ? { Cookie: userCookies } : {}) },
      timeoutMs: 30_000,
    },
    proxy,
  );
  const c = collectCookies(r.setCookies);
  if (c.length === 0) throw new Error('Mangalib: не удалось получить cookies DDoS-Guard (сайт изменил доступ)');
  jar = { cookies: c.join('; '), ts: Date.now() };
  return jar;
}

/** Invalidates the cached cookie jar (used when API calls start returning empty). */
export function resetMangalibJar(): void {
  jar = null;
}

function apiHeaders(cookies: string, siteId = 1): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/json',
    'Site-Id': String(siteId),
    Origin: 'https://mangalib.me',
    Referer: 'https://mangalib.me/',
  };
  const merged = [userCookies, cookies].filter(Boolean).join('; ');
  if (merged) h.Cookie = merged;
  return h;
}

export async function mangalibApi<T = any>(path: string, proxy?: string, timeoutMs = 30_000, siteId = 1): Promise<T> {
  let j = jar;
  if (!j || Date.now() - j.ts >= JAR_TTL) j = await primeCookieJar(proxy);
  const call = async (cookies: string): Promise<unknown> => {
    const r = await httpFetch({ url: `${API_BASE}${path}`, headers: apiHeaders(cookies, siteId), timeoutMs }, proxy);
    if (r.status !== 200) throw new Error(`HTTP ${r.status} (${API_BASE}${path})`);
    return JSON.parse(r.text);
  };
  if (j.cookies) {
    try {
      return (await call(j.cookies)) as T;
    } catch {
      resetMangalibJar();
    }
  }
  j = await primeCookieJar(proxy);
  return (await call(j.cookies)) as T;
}

const coverThumb = (m: any): string | null => {
  const c = m?.cover;
  if (!c) return null;
  return (c.filename ? (c.default ?? c.thumbnail ?? '') : (c.default ?? c.thumbnail ?? '')) || null;
};

function itemUrl(slugUrl: string, siteId = 1): string {
  return siteId === 2 ? `${HENTAILIB_BASE}/ru/manga/${slugUrl}` : `${MANGALIB_BASE}/${slugUrl}`;
}

interface ApiManga {
  name: string;
  rus_name?: string;
  eng_name?: string;
  slug_url: string;
  cover?: { default?: string; thumbnail?: string; md?: string };
  chap_count?: string | number;
  rate_avg?: number;
  type?: { label?: string };
  ageRestriction?: { id?: number; label?: string };
}

function toItem(m: ApiManga, siteId = 1): CatalogItem {
  const title = (m.rus_name || m.name || m.eng_name || '').trim() || 'Без названия';
  const cover = m.cover?.default || m.cover?.thumbnail || null;
  const chap = m.chap_count ? Number(m.chap_count) : null;
  return {
    url: itemUrl(m.slug_url, siteId),
    title,
    coverUrl: cover,
    // chap_count is the number of CHAPTERS: the card renders `pages` as "N стр.".
    pages: null,
    chapterCount: chap,
    score: typeof m.rate_avg === 'number' && m.rate_avg > 0 ? Number(m.rate_avg.toFixed(1)) : null,
    kind: m.type?.label ?? null,
    ageRestriction: m.ageRestriction?.id ?? null,
    // Regular Mangalib is a Main source; its 18+ age rating is not the R34
    // category. Only HentaiLIB (site 2) carries the adult/R34 badges.
    age18: siteId === 2,
    adult: siteId === 2 ? true : undefined,
  };
}

/** Catalog listing / search through the lib.social API. */
function addMany(params: URLSearchParams, key: string, values?: string[]): void {
  for (const value of values ?? []) {
    if (value) params.append(`${key}[]`, value);
  }
}

export async function searchMangalib(
  query: string,
  page = 0,
  proxy?: string,
  filters: CatalogFilters = {},
  siteId = 1,
): Promise<CatalogItem[]> {
  const params = new URLSearchParams();
  params.set('page', String(page + 1));
  if (query.trim()) params.set('q', query.trim());
  if (siteId === 2) params.append('site_id[]', '2');
  addMany(params, 'types', filters.mangalibTypes);
  addMany(params, 'status', filters.mangalibStatuses);
  addMany(params, 'format', filters.mangalibFormats);
  addMany(params, 'caution', filters.mangalibAgeRatings);
  addMany(params, 'genres', filters.mangalibGenres);
  addMany(params, 'tags', filters.mangalibTags);
  addMany(params, 'country', filters.mangalibCountries);
  addMany(params, 'bookmarks', filters.mangalibBookmarks);
  if (filters.mangalibChaptersMin) params.set('chap_count_min', filters.mangalibChaptersMin);
  if (filters.mangalibChaptersMax) params.set('chap_count_max', filters.mangalibChaptersMax);
  if (isValidDecimal(filters.mangalibRatingMin)) params.set('rating_min', filters.mangalibRatingMin!.trim());
  if (isValidDecimal(filters.mangalibRatingMax)) params.set('rating_max', filters.mangalibRatingMax!.trim());
  if (filters.mangalibVotesMin) params.set('rate_min', filters.mangalibVotesMin);
  if (filters.mangalibVotesMax) params.set('rate_max', filters.mangalibVotesMax);
  if (filters.mangalibYearMin) params.set('year_min', filters.mangalibYearMin);
  if (filters.mangalibYearMax) params.set('year_max', filters.mangalibYearMax);
  if (filters.mangalibSortBy) {
    params.set('sort_by', filters.mangalibSortBy);
    if (filters.mangalibOrder) params.set('order', filters.mangalibOrder);
  }
  const path = `/manga?${params.toString()}`;
  const j = await mangalibApi<{ data: ApiManga[] }>(path, proxy, 30_000, siteId);
  const rawList = Array.isArray(j?.data) ? j.data : [];
  // The lib.social endpoint accepts `caution[]` but does not consistently
  // filter by it (the site itself returns mixed ratings). Apply the selected
  // age ratings locally so the control is deterministic.
  const ageFilter = new Set((filters.mangalibAgeRatings ?? []).map(Number).filter((n) => Number.isFinite(n)));
  const list = ageFilter.size > 0 ? rawList.filter((m) => m.ageRestriction?.id != null && ageFilter.has(Number(m.ageRestriction.id))) : rawList;
  const seen = new Set<string>();
  const out: CatalogItem[] = [];
  for (const m of list) {
    if (typeof m?.slug_url !== 'string' || m.slug_url.length === 0) continue;
    const url = itemUrl(m.slug_url, siteId);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(toItem(m, siteId));
  }
  if (list.length === 0 && page > 0) return [];
  if (out.length === 0) {
    if (ageFilter.size > 0 && rawList.length > 0) return [];
    throw new Error(`${siteId === 2 ? 'HentaiLIB' : 'Mangalib'}: ${query.trim() ? 'поиск не дал результатов' : 'пустой каталог (проверь VPN/прокси)'}`);
  }
  return out;
}

// ── Chapters ────────────────────────────────────────────────────────────

export interface MangalibChapterRef {
  id: number;
  volume: string;
  number: string;
  /** Mirrors the volume in lib.social responses; not a fractional chapter suffix. */
  numberSecondary: string | null;
  name: string;
}

interface ApiChapter {
  id: number;
  volume: string | number;
  number: string | number;
  number_secondary?: string | number | null;
  name?: string | null;
  branches?: { expired_type?: number }[];
}

/** Full chapter list (all branches) for a series slug (slug_url like `7580--name`). */
export async function mangalibChapters(slugUrl: string, proxy?: string, siteId = 1): Promise<MangalibChapterRef[]> {
  const j = await mangalibApi<{ data: ApiChapter[] }>(`/manga/${encodeURIComponent(slugUrl)}/chapters`, proxy, 60_000, siteId);
  const list = Array.isArray(j?.data) ? j.data : [];
  return list
    .filter((c) => typeof c?.id === 'number' && Array.isArray(c?.branches) && c.branches.length > 0)
    .map((c) => ({
      id: c.id,
      volume: String(c.volume ?? 1),
      number: String(c.number ?? 0),
      numberSecondary: c.number_secondary != null ? String(c.number_secondary) : null,
      name: typeof c.name === 'string' ? c.name : '',
    }))
    .sort((a, b) => chSortValue(a) - chSortValue(b));
}

function chapterLabel(c: MangalibChapterRef): string {
  const vol = c.volume !== '' ? `Том ${c.volume} ` : '';
  const num = c.number ?? '';
  const base = `${vol}Глава ${num}`;
  return c.name && c.name.trim() ? `${base} — ${c.name.trim()}` : base;
}

/** Reader URL used as chapter_id throughout the app.
 * Regular Mangalib: `https://mangalib.me/<slug>/read/v<V>/c<C>`.
 * HentaiLIB: `https://hentailib.me/ru/<slug>/read/v<V>/c<C>`. */
export function mangalibChapterUrl(slugUrl: string, c: MangalibChapterRef, siteId = 1): string {
  // The API's `number` already contains genuine fractions (18.5). Its
  // `number_secondary` mirrors the volume and must not become another suffix.
  const base = siteId === 2 ? `${HENTAILIB_BASE}/ru` : MANGALIB_BASE;
  return `${base}/${slugUrl}/read/v${c.volume}/c${c.number}`;
}

/** Parses an app chapter URL back into (slug, volume, number). */
export function parseMangalibChapterUrl(url: string): { slug: string; volume: string; number: string } | null {
  const m = url.match(/\/(\d+--[a-z0-9-]+)\/(?:ru\/)?read\/v(\d+(?:\.\d+)?)\/c(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  return { slug: m[1], volume: m[2].replace(/^0+(?=\d)/, ''), number: m[3].replace(/^0+(?=\d)/, '') };
}

/** Formats a chapter label for the chapter list UI. */
export function mangalibChapterTitle(c: MangalibChapterRef): string {
  return chapterLabel(c);
}

/** Sort key for the chapter list (volume asc, number asc, secondary asc). */
export function mangalibChapterSortKey(c: MangalibChapterRef): number {
  return chSortValue(c);
}

function chSortValue(c: MangalibChapterRef): number {
  return Number(c.volume) * 1_000_000 + Number(c.number) * 1000;
}

// ── Chapter pages ───────────────────────────────────────────────────────

/** Default (compressed) image server picked from API constants (site 1). */
export async function mangalibImageServer(proxy?: string, siteId = 1): Promise<string> {
  const j = await mangalibApi<{ data?: { imageServers?: { id: string; url: string; site_ids?: number[] }[] } }>(
    '/constants?fields%5B0%5D=imageServers',
    proxy,
    20_000,
    siteId,
  );
  const servers = j?.data?.imageServers;
  const arr = Array.isArray(servers) ? servers : [];
  const forSite = (id: string): string | null => {
    const s = arr.find((x) => x.id === id && (x.site_ids?.includes(siteId) ?? false));
    return s ? s.url.replace(/\/+$/, '') : null;
  };
  return forSite('compress') ?? forSite('main') ?? 'https://img3.cdnlibs.org';
}

export interface MangalibPageSet {
  title: string;
  pageUrls: string[];
}

export async function mangalibChapterPages(
  slugUrl: string,
  volume: string | number,
  number: string | number,
  proxy?: string,
  siteId = 1,
): Promise<MangalibPageSet> {
  const apiNumber = String(number);
  const j = await mangalibApi<{ data: { pages?: { url?: string }[]; name?: string | null } }>(
    `/manga/${encodeURIComponent(slugUrl)}/chapter?volume=${encodeURIComponent(String(volume))}&number=${encodeURIComponent(apiNumber)}`,
    proxy,
    30_000,
    siteId,
  );
  const d = j?.data;
  const rels = (d?.pages ?? [])
    .map((p) => p.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0 && !u.startsWith('data:'));
  if (rels.length === 0) throw new Error('Mangalib: в главе нет страниц');
  const server = await mangalibImageServer(proxy, siteId);
  const pageUrls = rels.map((u) => `${server}${u.startsWith('//') ? u.slice(1) : u}`);
  const title = d?.name ? `Том ${volume} Глава ${number} — ${d.name}` : 'Mangalib';
  return { title: title.slice(0, 120), pageUrls };
}
