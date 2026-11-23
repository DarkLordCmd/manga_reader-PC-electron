import { httpGetJson, httpPostJson } from './http';
import { logger } from './logger';
import type { HistoryManager } from './history';
import type { LibraryService } from './library';
import type { SeriesRepository } from './series-repository';
import type { ReadingStatus } from '@shared/library';
import { normalizeWorkTitle } from '@shared/work-title';

/** v2 user_bookmarks list types: 1 reading, 2 planned, 3 completed,
 * 4 dropped, 5 on_hold, 6 not interesting, 7 favorite. */
const STATUS_BY_LIST_TYPE: Record<number, ReadingStatus | null> = {
  1: 'reading',
  2: 'planned',
  3: 'completed',
  4: 'dropped',
  5: 'on_hold',
  6: null,
  7: null,
};

/** Legacy v1 status ids (kept for fallback/in case Remanga returns them). */
const STATUS_BY_TYPE: Record<number, ReadingStatus | null> = {
  0: 'reading',
  1: 'planned',
  2: 'completed',
  3: 'dropped',
  4: 'on_hold',
  5: null,
};

export interface RemangaBookmarkType {
  id: number;
  name: string;
  count: number;
  /** 1..7 — the standard bookmark status this list represents. */
  type: number;
}

export interface RemangaMapped {
  url: string;
  title: string;
  coverUrl: string | null;
  source: string;
  seriesId: string;
  kind: string | null;
  adult: boolean;
  rating: number | null;
  status: ReadingStatus | null;
  favorite: boolean;
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
  // New lists are 1..7; old v1 statuses are 0..5. Type 6 = "not interesting"
  // and is intentionally skipped; type 7 = favorite (no reading status).
  const status = type >= 1 && type <= 7 ? (STATUS_BY_LIST_TYPE[type] ?? null) : (STATUS_BY_TYPE[type] ?? null);
  const favorite = type === 7;
  if (!status && !favorite) return null;
  const t = raw?.title && typeof raw.title === 'object' ? raw.title : raw?.manga && typeof raw.manga === 'object' ? raw.manga : raw;
  const dir = String(t?.dir ?? raw?.dir ?? '').trim();
  if (!dir) return null;
  const title = String(t?.rus_name ?? t?.main_name ?? t?.en_name ?? raw?.title_name ?? t?.name ?? 'Без названия').trim();
  const chapter = raw?.chapter && typeof raw.chapter === 'object' ? raw.chapter : null;
  const labelRaw = chapter?.chapter ?? raw?.chapter_number ?? raw?.chapter ?? null;
  // v2 bookmarks expose the number of read chapters as `read_progress`
  // (0 = not started) plus `read_progress_total`.
  const readProgress = number(raw?.read_progress ?? raw?.read_chapters ?? raw?.read_chapters_count);
  const indexRaw = number(raw?.chapter_index ?? chapter?.index);
  let chapterIndex: number | null = indexRaw;
  if (readProgress != null && readProgress > 0) chapterIndex = readProgress - 1;
  if (chapterIndex == null && number(labelRaw) != null) chapterIndex = Math.max(0, number(labelRaw)! - 1);
  const chapterLabel =
    readProgress != null && readProgress > 0
      ? String(readProgress)
      : labelRaw != null && String(labelRaw).trim()
        ? String(labelRaw)
        : chapterIndex != null
          ? String(chapterIndex + 1)
          : null;
  const total = number(raw?.read_progress_total ?? t?.count_chapters ?? raw?.count_chapters);
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
    favorite,
    chapterLabel,
    chapterIndex,
    chapterTotal: total,
    currentPage: Math.max(1, number(raw?.page) ?? 1),
  };
}

const API = 'https://api.remanga.org/api/v2';
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

export interface RemangaAuth {
  token?: string;
  cookies?: string;
}

/** The browser login window may expose the site's localStorage token as a
 * synthetic cookie (`mr_rm_token`), because the app only receives cookies. */
export function remangaAuthFromCookies(cookies: string): RemangaAuth {
  const token =
    (cookies ?? '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('mr_rm_token='))
      ?.slice('mr_rm_token='.length) ?? '';
  const clean = (cookies ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => !s.startsWith('mr_rm_token='))
    .join('; ');
  return { token: token ? decodeURIComponent(token) : '', cookies: clean };
}

function authHeaders(auth: RemangaAuth): Record<string, string> {
  return auth.token ? { Authorization: `Bearer ${auth.token}` } : auth.cookies ? { Cookie: auth.cookies } : {};
}

export async function resolveRemangaAuth(
  auth: RemangaAuth,
): Promise<{ id: number; username: string; auth: RemangaAuth } | null> {
  if (!auth.token && !auth.cookies) return null;
  const tryOnce = async (a: RemangaAuth): Promise<{ id: number; username: string } | null> => {
    try {
      const json = (await httpGetJson('https://api.remanga.org/api/v2/users/current/', {
        ...HEADERS,
        ...authHeaders(a),
      })) as any;
      const c = json?.content ?? json;
      const id = number(c?.id);
      if (id == null) return null;
      return { id, username: String(c?.username ?? c?.user?.username ?? id) };
    } catch (e) {
      logger.info('[remanga-import] current user failed', (e as Error)?.message ?? e);
      return null;
    }
  };
  // Browser login may expose a token that is not a Bearer (e.g. a storage
  // blob); the session cookie still works, so retry with it.
  if (auth.token) {
    const withToken = await tryOnce({ token: auth.token });
    if (withToken) return { ...withToken, auth: { token: auth.token } };
  }
  if (auth.cookies) {
    const withCookies = await tryOnce({ cookies: auth.cookies });
    if (withCookies) return { ...withCookies, auth: { cookies: auth.cookies } };
  }
  return null;
}

export async function remangaCurrentUser(auth: RemangaAuth): Promise<{ id: number; username: string } | null> {
  const r = await resolveRemangaAuth(auth);
  return r ? { id: r.id, username: r.username } : null;
}

async function fetchBookmarkTypes(auth: RemangaAuth, userId: number): Promise<RemangaBookmarkType[]> {
  const json = (await httpGetJson(`${API}/users/${userId}/user_bookmarks/`, {
    ...HEADERS,
    ...authHeaders(auth),
  })) as any;
  const results: any[] = json?.results ?? json?.content ?? [];
  return results
    .map((r) => ({
      id: number(r?.id) ?? 0,
      name: String(r?.name ?? ''),
      count: number(r?.count) ?? 0,
      type: number(r?.type) ?? 0,
    }))
    .filter((t) => t.id > 0 && t.type > 0);
}

async function fetchType(
  auth: RemangaAuth,
  userId: number,
  typeId: number,
  limit: number | undefined,
): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 50; page++) {
    const url = `${API}/users/${userId}/bookmarks/?type=${typeId}&page=${page}&ordering=-chapter_date`;
    let json: any;
    try {
      json = await httpGetJson(url, { ...HEADERS, ...authHeaders(auth) });
    } catch (e) {
      logger.info('[remanga-import] bookmarks page failed', typeId, page, (e as Error)?.message ?? e);
      break;
    }
    const items: any[] = json?.results ?? json?.content ?? [];
    if (items.length === 0) break;
    for (const raw of items) out.push(raw);
    if (limit && out.length >= limit) break;
    if (json?.next == null) break;
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
  auth: RemangaAuth,
  userId: number,
  opts: { limit?: number } = {},
): Promise<{ imported: number; updated: number; duplicates: number; byStatus: Record<string, number> }> {
  if ((!auth.token && !auth.cookies) || !userId) throw new Error('Сначала войдите в Remanga.');
  // Dynamic lists: ids differ per account, names/types are returned by
  // user_bookmarks (Читаю=1, Буду читать=2, Прочитано=3, Брошено=4,
  // Отложено=5, Не интересно=6, Любимое=7). Never assume ids 0..4.
  const types = await fetchBookmarkTypes(auth, userId);
  const batches: { raw: any; type: number }[] = [];
  for (const t of types) {
    if (t.type === 6) continue;
    const items = await fetchType(auth, userId, t.id, opts.limit);
    for (const raw of items) batches.push({ raw, type: t.type });
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
      if (m.favorite) deps.library.addFavorite(entry);
      else deps.library.setStatusFor(entry, m.status!);
      const key = m.favorite ? 'favorites' : m.status!;
      byStatus[key] = (byStatus[key] ?? 0) + 1;
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
