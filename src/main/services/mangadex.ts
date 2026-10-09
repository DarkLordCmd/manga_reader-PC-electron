import { httpGetJson } from './http';
import type { MangaCard } from '@shared/mangadex';

export type { MangaCard };

export interface ChapterInfo {
  chapter_id: string;
  chapter_num: string;
  title: string | null;
  lang: string;
}

export type MangaSort = 'relevance' | 'rating' | 'latestUploadedChapter' | 'followedCount';

const ORDER_KEY: Record<MangaSort, string> = {
  relevance: 'relevance',
  rating: 'rating',
  latestUploadedChapter: 'latestUploadedChapter',
  followedCount: 'followedCount',
};

export function parseMangaSearch(json: any): MangaCard[] {
  const data: any[] = json?.data ?? [];
  const cards: MangaCard[] = [];
  for (const manga of data) {
    const id = manga?.id;
    if (typeof id !== 'string') continue;
    const attrs = manga.attributes ?? {};
    const titles = attrs.title ?? {};
    const altTitles: any[] = attrs.altTitles ?? [];
    const findAlt = (lang: string): string | null => altTitles.map((t) => t?.[lang]).find((v) => typeof v === 'string') ?? null;
    const title =
      titles.ru ??
      findAlt('ru') ??
      titles.en ??
      findAlt('en') ??
      titles['ja-ro'] ??
      findAlt('ja-ro') ??
      Object.values(titles).find((v) => typeof v === 'string') ??
      'Без названия';
    const origLang = attrs.originalLanguage ?? '';
    const kind = origLang === 'ko' ? 'Манхва' : origLang === 'zh' || origLang === 'zh-hk' ? 'Маньхуа' : 'Манга';
    const score = typeof attrs.rating?.bayesian === 'number' ? attrs.rating.bayesian : null;
    const tags: string[] = (attrs.tags ?? [])
      .map((t: any) => t?.attributes?.name?.ru ?? t?.attributes?.name?.en)
      .filter((s: unknown): s is string => typeof s === 'string');
    const coverFile = (manga.relationships ?? []).find((r: any) => r?.type === 'cover_art')?.attributes?.fileName;
    const cover_url = typeof coverFile === 'string' ? `https://uploads.mangadex.org/covers/${id}/${coverFile}.256.jpg` : null;
    cards.push({ manga_id: id, title, cover_url, kind, score, tags });
  }
  return cards;
}

export function parseChapterFeed(json: any): ChapterInfo[] {
  const data: any[] = json?.data ?? [];
  const out: ChapterInfo[] = [];
  for (const ch of data) {
    const id = ch?.id;
    if (typeof id !== 'string') continue;
    const attrs = ch.attributes ?? {};
    const chapter_num = typeof attrs.chapter === 'string' ? attrs.chapter : '—';
    const title = typeof attrs.title === 'string' && attrs.title.length > 0 ? attrs.title : null;
    out.push({ chapter_id: id, chapter_num, title, lang: attrs.translatedLanguage ?? '' });
  }
  return out;
}

export function parseAggregate(json: any): number {
  const volumes: Record<string, any> = json?.volumes ?? {};
  let total = 0;
  for (const vol of Object.values(volumes)) {
    total += Object.keys(vol?.chapters ?? {}).length;
  }
  return total;
}

async function fetchFeed(manga_id: string, lang: string): Promise<ChapterInfo[]> {
  const url = `https://api.mangadex.org/manga/${manga_id}/feed`;
  const params = new URLSearchParams({ 'order[chapter]': 'asc', limit: '500', 'translatedLanguage[]': lang });
  const all: ChapterInfo[] = [];
  let offset = 0;
  for (;;) {
    params.set('offset', String(offset));
    const json = await httpGetJson(`${url}?${params.toString()}`);
    const batch = parseChapterFeed(json);
    all.push(...batch);
    if (batch.length < 500) break;
    offset += 500;
  }
  return all;
}

function isTagId(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function resolveTagIds(tags: string[]): Promise<string[]> {
  const out: string[] = [];
  const names: string[] = [];
  for (const t of tags) {
    if (isTagId(t)) out.push(t);
    else names.push(t);
  }
  if (names.length === 0) return out;
  const json: any = await httpGetJson('https://api.mangadex.org/manga/tag');
  const arr: any[] = json?.data ?? [];
  for (const n of names) {
    const found = arr.find((t: any) => {
      const nameEn = t?.attributes?.name?.en ?? '';
      const nameRu = t?.attributes?.name?.ru ?? '';
      return n.toLowerCase() === nameEn.toLowerCase() || n.toLowerCase() === nameRu.toLowerCase();
    });
    if (found?.id && typeof found.id === 'string') out.push(found.id);
  }
  return out;
}

export async function searchMangaDex(
  query: string,
  sort: MangaSort,
  page: number,
  tags: string[] = [],
  langs: string[] = [],
): Promise<MangaCard[]> {
  const tagIds = await resolveTagIds(tags);
  const params = new URLSearchParams({ limit: '30', offset: String(page * 30), 'includes[]': 'cover_art' });
  params.set(`order[${ORDER_KEY[sort]}]`, 'desc');
  for (const r of ['safe', 'suggestive', 'erotica']) params.append('contentRating[]', r);
  if (query) params.set('title', query);
  for (const t of tagIds) params.append('includedTags[]', t);
  for (const l of langs) params.append('availableTranslatedLanguage[]', l);
  const json = await httpGetJson(`https://api.mangadex.org/manga?${params.toString()}`);
  const cards = parseMangaSearch(json);
  if (cards.length === 0) throw new Error('Ничего не найдено.');
  return cards;
}

export async function fetchChapterList(manga_id: string): Promise<ChapterInfo[]> {
  const ru = await fetchFeed(manga_id, 'ru');
  if (ru.length > 0) return ru;
  const en = await fetchFeed(manga_id, 'en');
  if (en.length > 0) return en;
  throw new Error('У этой манги пока нет доступных глав.');
}

export async function fetchChapterCount(manga_id: string): Promise<number> {
  const params = new URLSearchParams({ 'translatedLanguage[]': 'ru' });
  let json = await httpGetJson(`https://api.mangadex.org/manga/${manga_id}/aggregate?${params.toString()}`);
  let count = parseAggregate(json);
  if (count === 0) {
    json = await httpGetJson(`https://api.mangadex.org/manga/${manga_id}/aggregate`);
    count = parseAggregate(json);
  }
  return count;
}

export interface AtHomeChapter {
  baseUrl: string;
  hash: string;
  files: string[];
}

export async function resolveAtHome(chapter_id: string): Promise<AtHomeChapter> {
  const json: any = await httpGetJson(`https://api.mangadex.org/at-home/server/${chapter_id}`);
  const baseUrl = json?.baseUrl;
  const hash = json?.chapter?.hash;
  const files: unknown = json?.chapter?.data;
  if (typeof baseUrl !== 'string') throw new Error("API response missing 'baseUrl'");
  if (typeof hash !== 'string') throw new Error("API response missing 'chapter.hash'");
  if (!Array.isArray(files) || files.length === 0) throw new Error('Chapter has no pages');
  return { baseUrl, hash, files: files.filter((f): f is string => typeof f === 'string') };
}
