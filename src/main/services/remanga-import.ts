import { httpGetJson, httpPostJson } from './http';
import { logger } from './logger';
import type { HistoryManager } from './history';
import type { LibraryService } from './library';
import type { SeriesRepository } from './series-repository';
import type { ReadingStatus } from '@shared/library';
import { normalizeWorkTitle } from '@shared/work-title';

/** Remanga bookmark types (v1 API): 0 reading, 1 will read, 2 read,
 * 3 abandoned, 4 postponed, 5 not interesting. */
const STATUS_BY_TYPE: Record<number, ReadingStatus | null> = {
  0: 'reading',
  1: 'planned',
  2: 'completed',
  3: 'dropped',
  4: 'on_hold',
  5: null,
};

export interface RemangaMapped {
  url: string;
  title: string;
  coverUrl: string | null;
  source: string;
  seriesId: string;
  kind: string | null;
  adult: boolean;
  rating: number | null;
  status: ReadingStatus;
  chapterLabel: string | null;
  chapterIndex: number | null;
  chapterTotal: number | null;
  currentPage: number;
}

function number(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null;
}

function coverUrl(t: any): string | null {
  const c = t?.cover?.high ?? t?.cover?.mid ?? t?.img?.high ?? t?.img?.mid ?? null;
  if (typeof c !== 'string' || !c) return null;
  return c.startsWith('http') ? c : `https://remanga.org${c.startsWith('/') ? '' : '/'}${c}`;
}

/** Tolerant mapper: Remanga has changed the bookmark response shape more than
 * once (title/chapter nested or flattened), so both are accepted. */
export function mapRemangaBookmark(raw: any, type: number): RemangaMapped | null {
  const status = STATUS_BY_TYPE[type] ?? null;
  if (!status) return null;
  const t = raw?.title && typeof raw.title === 'object' ? raw.title : raw?.manga && typeof raw.manga === 'object' ? raw.manga : raw;
  const dir = String(t?.dir ?? raw?.dir ?? '').trim();
  if (!dir) return null;
  const title = String(t?.rus_name ?? t?.main_name ?? t?.en_name ?? raw?.title_name ?? t?.name ?? 'Без названия').trim();
  const chapter = raw?.chapter && typeof raw.chapter === 'object' ? raw.chapter : null;
  const labelRaw = chapter?.chapter ?? raw?.chapter_number ?? raw?.chapter ?? null;
  const readCount = number(raw?.read_chapters ?? raw?.read_chapters_count);
  const indexRaw = number(raw?.chapter_index ?? chapter?.index);
  let chapterIndex: number | null = indexRaw;
  if (readCount != null && readCount > 0) chapterIndex = readCount - 1;
  if (chapterIndex == null && number(labelRaw) != null) chapterIndex = Math.max(0, number(labelRaw)! - 1);
  const chapterLabel = labelRaw != null && String(labelRaw).trim() ? String(labelRaw) : chapterIndex != null ? String(chapterIndex + 1) : null;
  const total = number(t?.count_chapters ?? raw?.count_chapters);
  const rawRating = number(t?.avg_rating ?? raw?.avg_rating);
  const rating = rawRating != null && rawRating > 0 ? Math.min(10, Math.round(rawRating * 10) / 10) : null;
  const kind =
    (typeof t?.type === 'object' ? t.type?.name : typeof t?.type === 'string' ? t.type : null) ??
    (t?.type === 2 ? 'Манхва' : t?.type === 3 ? 'Маньхуа' : t?.type === 1 ? 'Манга' : null);
  const adult = t?.is_erotic === true || t?.is_forbidden === true || (number(t?.age_limit) ?? 0) >= 18;
  const url = `https://remanga.org/manga/${dir}/`;
  return {
    url,
    title,
    coverUrl: coverUrl(t),
    source: 'Remanga',
    seriesId: url,
    kind: kind ?? null,
    adult,
    rating,
    status,
    chapterLabel,
    chapterIndex,
    chapterTotal: total,
    currentPage: Math.max(1, number(raw?.page) ?? 1),
  };
}

const API = 'https://api.remanga.org/api';
const HEADERS = {
  Accept: 'application/json',
  Referer: 'https://remanga.org/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

export async function remangaLogin(
  user: string,
  password: string,
): Promise<{ ok: boolean; message: string; token?: string; userId?: number; username?: string }> {
  if (!user.trim() || !password) return { ok: false, message: 'Введите логин/почту и пароль Remanga.' };
  try {
    const json = (await httpPostJson(
      `${API}/users/login/`,
      JSON.stringify({ user: user.trim(), password }),
      { ...HEADERS, 'Content-Type': 'application/json' },
    )) as any;
    const content = json?.content ?? json;
    const token = typeof content?.access_token === 'string' ? content.access_token : '';
    const userId = number(content?.id);
    if (!token || userId == null) {
      return { ok: false, message: String(json?.msg ?? 'Remanga не вернул токен.') };
    }
    return {
      ok: true,
      message: `Вошли в Remanga${content?.username ? ` как ${content.username}` : ''}.`,
      token,
      userId,
      username: String(content?.username ?? user.trim()),
    };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/HTTP (400|401)\b/.test(msg)) return { ok: false, message: 'Неверный логин/пароль Remanga.' };
    if (/HTTP 403\b/.test(msg)) return { ok: false, message: 'Remanga отклонила запрос (403). Попробуйте позже или с другим подключением.' };
    return { ok: false, message: `Remanga: ${msg}` };
  }
}

async function fetchType(
  token: string,
  userId: number,
  type: number,
  limit: number | undefined,
): Promise<{ raw: any; type: number }[]> {
  const out: { raw: any; type: number }[] = [];
  for (let page = 1; page <= 50; page++) {
    const url = `${API}/users/${userId}/bookmarks?type=${type}&page=${page}&ordering=-chapter_date`;
    let json: any;
    try {
      json = await httpGetJson(url, { ...HEADERS, Authorization: `Bearer ${token}` });
    } catch (e) {
      logger.info('[remanga-import] bookmarks page failed', type, page, (e as Error)?.message ?? e);
      break;
    }
    const items: any[] = json?.content ?? json?.results ?? [];
    if (items.length === 0) break;
    for (const raw of items) out.push({ raw, type });
    if (limit && out.length >= limit) break;
    const totalPages = number(json?.props?.total_pages ?? json?.total_pages);
    if (totalPages != null && page >= totalPages) break;
  }
  return limit ? out.slice(0, limit) : out;
}

export interface RemangaImportDeps {
  library: LibraryService;
  history: HistoryManager;
  repo: SeriesRepository;
}

export async function importRemangaBookmarks(
  deps: RemangaImportDeps,
  token: string,
  userId: number,
  opts: { limit?: number } = {},
): Promise<{ imported: number; updated: number; duplicates: number; byStatus: Record<string, number> }> {
  if (!token || !userId) throw new Error('Сначала войдите в Remanga.');
  const batches: { raw: any; type: number }[] = [];
  for (const type of [0, 1, 2, 3, 4]) {
    batches.push(...(await fetchType(token, userId, type, opts.limit)));
  }

  const existing = deps.repo.all();
  const existingUrls = new Set(existing.map((i) => i.url.replace(/\/+$/, '').toLowerCase()));
  const existingTitles = new Set(existing.map((i) => normalizeWorkTitle(i.title)).filter((t) => t.length >= 4));
  const seenTitles = new Set<string>();
  let imported = 0;
  let updated = 0;
  let duplicates = 0;
  const byStatus: Record<string, number> = {};
  const seenUrls = new Set<string>();

  for (const { raw, type } of batches) {
    const m = mapRemangaBookmark(raw, type);
    if (!m) continue;
    const norm = m.url.replace(/\/+$/, '').toLowerCase();
    if (seenUrls.has(norm)) continue;
    seenUrls.add(norm);
    const titleKey = normalizeWorkTitle(m.title);
    if (titleKey.length >= 4 && (existingTitles.has(titleKey) || seenTitles.has(titleKey))) duplicates++;
    if (titleKey.length >= 4) seenTitles.add(titleKey);

    const entry = {
      url: m.url,
      title: m.title,
      coverUrl: m.coverUrl,
      source: m.source,
      seriesId: m.seriesId,
      kind: m.kind,
      adult: m.adult,
    };
    try {
      deps.library.setStatusFor(entry, m.status);
      byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
      if (existingUrls.has(norm)) updated++;
      else imported++;
    } catch (e) {
      logger.warn('[remanga-import] library add failed', m.url, (e as Error)?.message ?? e);
      continue;
    }
    try {
      deps.history.addOrUpdate({
        url: m.url,
        series_id: m.seriesId,
        title: m.title,
        cover_url: m.coverUrl,
        source: m.source,
        chapter_label: m.chapterLabel,
        chapter_index: m.chapterIndex,
        chapter_total: m.chapterTotal,
        total_pages: 0,
        category: m.adult ? 'r34' : 'main',
        kind: m.kind,
      });
    } catch {
      /* progress is best-effort */
    }
  }
  return { imported, updated, duplicates, byStatus };
}
