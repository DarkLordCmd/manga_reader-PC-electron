import { httpFetch } from '../http';
import { type CatalogItem } from './catalog-types';

// Mangalib's SPA talks to a shared lib.social JSON API on api.cdnlibs.org.
// The API silently returns empty lists for requests without DDoS-Guard
// cookies, so every client first "visits" mangalib.me to collect the
// __ddg*/XSRF/session cookies and then sends them along with Site-Id: 1.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const API_BASE = 'https://api.cdnlibs.org/api';
const SITE_ID = '1';
export const MANGALIB_BASE = 'https://mangalib.me';

interface Jar {
  cookies: string;
  ts: number;
}

let jar: Jar | null = null;
const JAR_TTL = 30 * 60_000;

function collectCookies(setCookies: string[]): string[] {
  return setCookies.map((c) => c.split(';')[0]).filter(Boolean);
}

/** Visits mangalib.me once to pick up DDoS-Guard cookies for API calls. */
async function primeCookieJar(): Promise<Jar> {
  if (jar && Date.now() - jar.ts < JAR_TTL) return jar;
  const r = await httpFetch({
    url: 'https://mangalib.me/',
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    timeoutMs: 30_000,
  });
  const c = collectCookies(r.setCookies);
  if (c.length === 0) throw new Error('Mangalib: не удалось получить cookies DDoS-Guard (сайт изменил доступ)');
  jar = { cookies: c.join('; '), ts: Date.now() };
  return jar;
}

/** Invalidates the cached cookie jar (used when API calls start returning empty). */
export function resetMangalibJar(): void {
  jar = null;
}

function apiHeaders(cookies: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/json',
    'Site-Id': SITE_ID,
    Origin: 'https://mangalib.me',
    Referer: 'https://mangalib.me/',
  };
  if (cookies) h.Cookie = cookies;
  return h;
}

export async function mangalibApi<T = any>(path: string, proxy?: string, timeoutMs = 30_000): Promise<T> {
  let j = jar;
  if (!j || Date.now() - j.ts >= JAR_TTL) j = await primeCookieJar();
  const call = async (cookies: string): Promise<unknown> => {
    const r = await httpFetch({ url: `${API_BASE}${path}`, headers: apiHeaders(cookies), timeoutMs }, proxy);
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
  j = await primeCookieJar();
  return (await call(j.cookies)) as T;
}

const coverThumb = (m: any): string | null => {
  const c = m?.cover;
  if (!c) return null;
  return (c.filename ? (c.default ?? c.thumbnail ?? '') : (c.default ?? c.thumbnail ?? '')) || null;
};

function itemUrl(slugUrl: string): string {
  return `${MANGALIB_BASE}/${slugUrl}`;
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
}

function toItem(m: ApiManga): CatalogItem {
  const title = (m.rus_name || m.name || m.eng_name || '').trim() || 'Без названия';
  const cover = m.cover?.default || m.cover?.thumbnail || null;
  const chap = m.chap_count ? Number(m.chap_count) : null;
  return {
    url: itemUrl(m.slug_url),
    title,
    coverUrl: cover,
    pages: Number.isFinite(Number(m.chap_count)) && m.chap_count != null ? Number(m.chap_count) : null,
    score: typeof m.rate_avg === 'number' && m.rate_avg > 0 ? Number(m.rate_avg.toFixed(1)) : null,
    kind: m.type?.label ?? null,
  };
}

/** Catalog listing / search through the lib.social API. */
export async function searchMangalib(query: string, page = 0, proxy?: string): Promise<CatalogItem[]> {
  const params = new URLSearchParams();
  params.set('page', String(page + 1));
  if (query.trim()) params.set('q', query.trim());
  const path = `/manga?${params.toString()}`;
  const j = await mangalibApi<{ data: ApiManga[] }>(path, proxy);
  const list = Array.isArray(j?.data) ? j.data : [];
  const seen = new Set<string>();
  const out: CatalogItem[] = [];
  for (const m of list) {
    if (typeof m?.slug_url !== 'string' || m.slug_url.length === 0) continue;
    const url = itemUrl(m.slug_url);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(toItem(m));
  }
  if (out.length === 0)
    throw new Error(query.trim() ? 'Mangalib: поиск не дал результатов' : 'Mangalib: пустой каталог (проверь VPN/прокси)');
  return out;
}

// ── Chapters ────────────────────────────────────────────────────────────

export interface MangalibChapterRef {
  id: number;
  volume: string;
  number: string;
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
export async function mangalibChapters(slugUrl: string, proxy?: string): Promise<MangalibChapterRef[]> {
  const j = await mangalibApi<{ data: ApiChapter[] }>(`/manga/${encodeURIComponent(slugUrl)}/chapters`, proxy, 60_000);
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
  const secondary = c.numberSecondary ? `.${c.numberSecondary}` : '';
  const base = `${vol}Глава ${num}${secondary}`;
  return c.name && c.name.trim() ? `${base} — ${c.name.trim()}` : base;
}

/** Reader URL used as chapter_id throughout the app: `https://mangalib.me/<slug>/read/v<V>/c<C>`. */
export function mangalibChapterUrl(slugUrl: string, c: MangalibChapterRef): string {
  return `${MANGALIB_BASE}/${slugUrl}/read/v${c.volume}/c${c.number}`;
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
  return Number(c.volume) * 1000 + Number(c.number) * 10 + Number(c.numberSecondary || 0);
}

// ── Chapter pages ───────────────────────────────────────────────────────

/** Default (compressed) image server picked from API constants (site 1). */
export async function mangalibImageServer(proxy?: string): Promise<string> {
  const j = await mangalibApi<{ data?: { imageServers?: { id: string; url: string; site_ids?: number[] }[] } }>(
    '/constants?fields%5B0%5D=imageServers',
    proxy,
    20_000,
  );
  const servers = j?.data?.imageServers;
  const arr = Array.isArray(servers) ? servers : [];
  const forSite = (id: string): string | null => {
    const s = arr.find((x) => x.id === id && (x.site_ids?.includes(1) ?? false));
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
): Promise<MangalibPageSet> {
  const j = await mangalibApi<{ data: { pages?: { url?: string }[]; name?: string | null } }>(
    `/manga/${encodeURIComponent(slugUrl)}/chapter?volume=${encodeURIComponent(String(volume))}&number=${encodeURIComponent(String(number))}`,
    proxy,
  );
  const d = j?.data;
  const rels = (d?.pages ?? [])
    .map((p) => p.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0 && !u.startsWith('data:'));
  if (rels.length === 0) throw new Error('Mangalib: в главе нет страниц');
  const server = await mangalibImageServer(proxy);
  const pageUrls = rels.map((u) => `${server}${u}`);
  const title = d?.name ? `Том ${volume} Глава ${number} — ${d.name}` : 'Mangalib';
  return { title: title.slice(0, 120), pageUrls };
}
