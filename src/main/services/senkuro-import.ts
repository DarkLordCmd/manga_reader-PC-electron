import type { SenkuroImportProgress, SenkuroImportResult } from '@shared/ipc';
import type { ReadingStatus } from '@shared/library';
import type { Settings } from '@shared/settings';
import { httpFetch } from './http';
import { fetchSenkuroChapters } from './sources/senkuro';
import { senkuroLabelsAreR34 } from './senkuro-r34-labels';
import { categoryForUrl } from './series-key';
import type { LibraryService } from './library';
import type { HistoryManager } from './history';
import type { SettingsService } from './settings';
import { logger } from './logger';

/** Senkognito is the Senkuro ecosystem's frontend for the same bookmarks. It
 * uses a persisted GraphQL API with the SAME SSO access token Senkuro issues,
 * so the app's stored `senkuro_cookies_raw` is enough — no second login. */
const SKG_GRAPHQL = 'https://api.senkognito.com/graphql';

/** app read_chapters list is capped at 4000 entries in settings. Importing a
 * 129-work "Читаю" list fully would not fit, so keep at most this many chapters
 * per work (the ones right before the resume point — the useful ones). */
const PER_WORK_READ_MARKS = 40;
const READ_CAP = 4000;
const PROGRESS_CAP = 1000;

const STATUS_MAP: Record<string, ReadingStatus> = {
  WATCHING: 'reading',
  PLANNING: 'planned',
  COMPLETED: 'completed',
  PAUSED: 'on_hold',
  DROPPED: 'dropped',
};
const KIND_MAP: Record<string, string> = {
  MANGA: 'Манга',
  MANHWA: 'Манхва',
  MANHUA: 'Маньхуа',
  COMICS: 'Комикс',
  OEL_MANGA: 'OEL Манга',
  RU_MANGA: 'РуМанга',
};

interface SkgCollection {
  id: string;
  slug: string;
  name: string;
  entityType: string;
  status: string;
  system: boolean;
}

interface SkgBookmark {
  entityId: string;
  collectionId: string;
  page: number | null;
  number: string | null;
  entity: {
    slug: string;
    titles: { lang: string; content: string }[];
    chapters: number | null;
    type?: string | null;
    rating?: string | null;
    labels?: { slug: string }[];
    lastChapterAt?: string | null;
    cover?: { original?: { url?: string | null } | null } | null;
  };
}

export interface SenkuroImportDeps {
  library: LibraryService;
  history: HistoryManager;
  settings: SettingsService;
  proxy?: string;
  onProgress?: (p: SenkuroImportProgress) => void;
}

function tokenFromCookies(raw: string): string {
  return (raw ?? '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('access_token='))
    ?.slice('access_token='.length) ?? '';
}

async function skgQuery<T>(token: string, query: string, variables: Record<string, unknown>, proxy?: string): Promise<T> {
  const r = await httpFetch(
    {
      url: SKG_GRAPHQL,
      method: 'POST',
      body: JSON.stringify({ query, variables }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'App-Id': '4026531840100',
        Authorization: `Bearer ${token}`,
      },
      timeoutMs: 30_000,
    },
    proxy,
  );
  logger.info('[skg-import] graphql status=', r.status, 'authLen=', token.length, 'body=', r.text.slice(0, 180));
  if (r.status >= 300) throw new Error(`HTTP ${r.status}`);
  const json = JSON.parse(r.text) as any;
  if (Array.isArray(json?.errors) && json.errors.length > 0) throw new Error(String(json.errors[0]?.message ?? 'GraphQL error'));
  return json?.data as T;
}

const VIEWER_QUERY = `query {
  viewer {
    user { id name }
    userBookmarkCollections { id slug name entityType status system }
  }
}`;

const BOOKMARKS_QUERY = `query($userId: ID!, $after: String) {
  userBookmarks(first: 20, userId: $userId, subjectType: MANGA, after: $after) {
    edges { node {
      entityId collectionId page number
      entity { __typename ... on Manga { slug titles { lang content } chapters type rating labels { slug } lastChapterAt cover { original { url } } } }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Chapter label from senkuroChapterNumber(): "volume / chapter" ("2 / 5") or a
 * bare number ("43"). The CHAPTER is the LAST part — parsing the first number
 * treated every volume-1 chapter as chapter 1, which marked entire works read. */
export function chapterNumberValue(label: string | null | undefined): number | null {
  const s = String(label ?? '').trim();
  if (!s) return null;
  const parts = s.split('/');
  const m = parts[parts.length - 1].match(/\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const v = Number(m[0].replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function pickTitle(titles: { lang: string; content: string }[] | undefined): string {
  if (!titles?.length) return 'Без названия';
  return titles.find((t) => t.lang === 'RU')?.content ?? titles.find((t) => t.lang === 'EN')?.content ?? titles[0].content;
}

function capList<T>(list: T[], limit: number): T[] {
  return list.length <= limit ? list : list.slice(list.length - limit);
}

/**
 * Imports the viewer's manga bookmarks from Senkognito:
 * statuses (Читаю/В планах/Прочитано/Любимое/Отложено/Брошено), the chapter they
 * stopped at (series progress + resume page) and the chapters already read.
 */
export async function runSenkuroImport(
  deps: SenkuroImportDeps,
  opts: { statuses?: string[]; markRead?: boolean; limit?: number } = {},
): Promise<SenkuroImportResult> {
  const settings = deps.settings.get();
  const token = tokenFromCookies(settings.senkuro_cookies_raw);
  const empty = (message: string): SenkuroImportResult => ({
    ok: false,
    message,
    imported: 0,
    byStatus: {},
    chaptersMarked: 0,
    resumePoints: 0,
    errors: 0,
  });
  if (!token) {
    return empty('Нет токена Senkuro. Войди в Senkuro в Настройках — импорт использует тот же аккаунт (Senkognito).');
  }
  const onProgress = deps.onProgress ?? (() => {});
  const markRead = opts.markRead !== false;

  let root: { viewer?: { user?: { id?: string }; userBookmarkCollections?: SkgCollection[] } };
  try {
    root = await skgQuery(token, VIEWER_QUERY, {}, deps.proxy);
  } catch (e) {
    return empty(`Senkognito: не удалось прочитать аккаунт (${(e as Error)?.message ?? e}). Проверь вход в Senkuro.`);
  }
  // skgQuery already unwraps `data`, so the viewer lives under `.viewer`.
  const viewer = root?.viewer;
  const userId = viewer?.user?.id;
  if (!userId) return empty('Senkognito не вернул пользователя — вероятно, токен Senkuro устарел. Войди заново.');

  const collections = (viewer?.userBookmarkCollections ?? []).filter((c) => c.entityType === 'MANGA');
  const collById = new Map(collections.map((c) => [c.id, c]));
  const wanted = new Set(
    (opts.statuses?.length ? opts.statuses : ['WATCHING', 'PLANNING', 'COMPLETED', 'FAVORITED', 'PAUSED', 'DROPPED']).map((s) =>
      s.toUpperCase(),
    ),
  );

  // 1. all manga bookmarks (paginated), then filter by the selected collections
  const bookmarks: SkgBookmark[] = [];
  let after: string | null = null;
  onProgress({ phase: 'bookmarks', done: 0, total: 0 });
  try {
    for (let page = 0; page < 40; page++) {
      const data: any = await skgQuery(token, BOOKMARKS_QUERY, { userId, after }, deps.proxy);
      const conn = data?.userBookmarks;
      for (const edge of conn?.edges ?? []) if (edge?.node) bookmarks.push(edge.node as SkgBookmark);
      onProgress({ phase: 'bookmarks', done: bookmarks.length, total: bookmarks.length });
      if (!conn?.pageInfo?.hasNextPage || !conn?.pageInfo?.endCursor) break;
      after = conn.pageInfo.endCursor;
    }
  } catch (e) {
    return empty(`Senkognito: не удалось загрузить закладки (${(e as Error)?.message ?? e}).`);
  }

  let rows = bookmarks.filter((b) => {
    const c = collById.get(b.collectionId);
    return !!c && wanted.has(c.status);
  });
  // Most recently active works last: the read list keeps the LAST 4000 entries,
  // so "Читаю" (the source of truth for progress) must be appended after the
  // rest and survive the cap.
  const rank = (b: SkgBookmark): number => (collById.get(b.collectionId)?.status === 'WATCHING' ? 1 : 0);
  rows.sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return String(a.entity?.lastChapterAt ?? '').localeCompare(String(b.entity?.lastChapterAt ?? ''));
  });
  if (opts.limit && opts.limit > 0) rows = rows.slice(0, Math.min(opts.limit, 500));

  const readIds = new Set<string>();
  const readProgress: Record<string, [number, number]> = {};
  const byStatus: Record<string, number> = {};
  let imported = 0;
  let errors = 0;
  let resumePoints = 0;

  for (let i = 0; i < rows.length; i++) {
    const bm = rows[i];
    const coll = collById.get(bm.collectionId);
    if (!coll) continue;
    const entity = bm.entity ?? ({} as SkgBookmark['entity']);
    const url = `https://senkuro.me/manga/${entity.slug ?? ''}/`;
    const title = pickTitle(entity.titles);
    const status = STATUS_MAP[coll.status];
    const favorite = coll.status === 'FAVORITED';
    const entry = {
      url,
      title,
      coverUrl: entity.cover?.original?.url ?? null,
      source: 'Senkuro',
      seriesId: url,
      category: categoryForUrl(url),
      kind: KIND_MAP[String(entity.type ?? '')] ?? null,
      adult: senkuroLabelsAreR34(entity.labels),
    };
    onProgress({ phase: 'chapters', done: i, total: rows.length, title });
    try {
      if (favorite) deps.library.addFavorite(entry);
      else if (status) deps.library.setStatusFor(entry, status);
      else deps.library.addFromCatalog(entry);
      imported++;
      byStatus[coll.status] = (byStatus[coll.status] ?? 0) + 1;
    } catch (e) {
      errors++;
      logger.warn('[skg-import] library add failed', url, (e as Error)?.message ?? e);
      continue;
    }

    const current = chapterNumberValue(bm.number);
    if (current == null) continue;

    let chapters: { chapter_id: string; chapter_num: string }[] = [];
    let chapterIndex: number | null = null;
    if (markRead) {
      try {
        const res = await fetchSenkuroChapters(String(entity.slug ?? ''), settings.senkuro_cookies_raw, deps.proxy);
        chapters = res.chapters.map((c) => ({ chapter_id: c.chapter_id, chapter_num: c.chapter_num }));
        chapterIndex = chapters.findIndex((c) => chapterNumberValue(c.chapter_num) === current);
        if (chapterIndex < 0) {
          // Finished works: the bookmark can point one past the last chapter.
          // Use the last chapter at or before the resume point instead of null.
          let best = -1;
          chapters.forEach((c, idx) => {
            const n = chapterNumberValue(c.chapter_num);
            if (n != null && n <= current) best = idx;
          });
          chapterIndex = best >= 0 ? best : null;
        }
        // Chapters strictly before the resume point are read; if there is no
        // page (the user stopped between chapters) the current one counts too.
        const upto = chapters.filter((c) => {
          const n = chapterNumberValue(c.chapter_num);
          if (n == null) return false;
          return bm.page == null ? n <= current : n < current;
        });
        const keep = upto.slice(Math.max(0, upto.length - PER_WORK_READ_MARKS));
        for (const c of keep) readIds.add(c.chapter_id);
        if (bm.page != null && chapterIndex != null) {
          readProgress[chapters[chapterIndex].chapter_id] = [Math.max(1, Number(bm.page) || 1), 0];
          resumePoints++;
        }
      } catch (e) {
        logger.info('[skg-import] chapters failed', entity.slug, (e as Error)?.message ?? e);
      }
    }
    try {
      deps.history.addOrUpdate({
        url,
        series_id: url,
        title,
        cover_url: entity.cover?.original?.url ?? null,
        source: 'Senkuro',
        chapter_label: bm.number != null ? String(bm.number) : null,
        chapter_index: chapterIndex,
        chapter_total: chapters.length > 0 ? chapters.length : (entity.chapters ?? null),
        total_pages: 0,
        category: categoryForUrl(url),
        kind: KIND_MAP[String(entity.type ?? '')] ?? null,
      });
    } catch {
      /* progress is best-effort */
    }
  }

  // 2. persist read state (settings are main-owned; one write, then broadcast)
  onProgress({ phase: 'saving', done: rows.length, total: rows.length });
  const nextRead: string[] = [...settings.read_chapters];
  for (const id of readIds) if (!nextRead.includes(id)) nextRead.push(id);
  const read_chapters = capList(nextRead, READ_CAP);
  const mergedProgress: Record<string, [number, number]> = { ...settings.read_progress, ...readProgress };
  const progressKeys = Object.keys(mergedProgress);
  const read_progress = progressKeys.length <= PROGRESS_CAP
    ? mergedProgress
    : Object.fromEntries(progressKeys.slice(-PROGRESS_CAP).map((k) => [k, mergedProgress[k]]));
  const nextSettings: Settings = { ...settings, read_chapters, read_progress };
  deps.settings.save(nextSettings);

  return {
    ok: true,
    message:
      `Импортировано произведений: ${imported}` +
      (readIds.size > 0 ? `, отмечено прочитанных глав: ${Math.min(readIds.size, READ_CAP)} (по ${PER_WORK_READ_MARKS} последних на произведение)` : '') +
      (resumePoints > 0 ? `, точек продолжения: ${resumePoints}` : '') +
      (errors > 0 ? `, ошибок: ${errors}` : ''),
    imported,
    byStatus,
    chaptersMarked: readIds.size,
    resumePoints,
    errors,
  };
}
