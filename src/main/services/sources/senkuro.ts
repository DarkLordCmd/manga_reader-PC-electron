import { httpPostJson } from '../http';
import { SwrCache } from '../swr-cache';
import { createHash } from 'crypto';
import { logger } from '../logger';
import { fetchSenkuroR34Flags, senkuroLabelsAreR34 } from '../senkuro-r34-labels';
import { type CatalogItem } from './catalog-types';
import type { ChapterInfo } from './remanga';
import { SENKURO_STATUS } from '@shared/filters';

/** Enum → Russian label for the card/overlay badges. */
const SK_STATUS_LABELS = new Map(SENKURO_STATUS);
const SK_KIND = new Map<string, string>([
  ['MANGA', 'Манга'],
  ['MANHWA', 'Манхва'],
  ['MANHUA', 'Маньхуа'],
  ['COMICS', 'Комикс'],
  ['OEL_MANGA', 'OEL Манга'],
  ['RU_MANGA', 'РуМанга'],
]);

const SENKURO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// senkuro.me domain overrides the shared website config: its own API host
// (api.senkuro.me) and client id (4026531840100). The Hub config
// (api.senkuro.org / 1006632962658) returns an EMPTY catalog for browse —
// guessing the wrong host was why searches came back empty.
const SENKURO_GRAPHQL = 'https://api.senkuro.me/graphql';

/** Chapter number label from the API's `number`/`volume` fields, which are
 * STRINGS despite the GraphQL scalar. Dedupes the common case where volume and
 * number coincide (volume "1", number "1" → "1"), keeps multi-volume works
 * readable ("2 / 5"). */
export function senkuroChapterNumber(number: unknown, volume: unknown): string {
  const num = number != null ? String(number) : '';
  const vol = volume != null ? String(volume) : '';
  if (!num) return '';
  return vol && vol !== num ? `${vol} / ${num}` : num;
}

export function senkuroHeaders(cookieHeader: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'App-Id': '4026531840100',
    'App-Version': '050926',
    Origin: 'https://senkuro.me',
    Accept: 'application/json',
  };
  if (cookieHeader) {
    h.Cookie = cookieHeader;
    const token = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('access_token='))
      ?.slice('access_token='.length);
    if (token) h.Authorization = `Bearer ${token}`;
  }
  return h;
}

/** Builds the GraphQL `orderBy` clause with the enum values the API actually
 * has (POPULARITY_SCORE / SCORE / VIEWS / CHAPTERS / CREATED_AT). The old mapper
 * passed RATING/ID, which made every explicit sort fail with a GraphQL enum
 * error. '-' prefix = DESC, a bare field = ASC, nothing = popularity. */
export function senkuroOrderPart(ordering: string | undefined): string {
  const raw = ordering?.trim() ?? '';
  const direction = raw && !raw.startsWith('-') ? 'ASC' : 'DESC';
  const key = raw.replace(/^-/, '') || 'popularity';
  const field =
    key === 'score' ? 'SCORE' : key === 'views' ? 'VIEWS' : key === 'chapters' ? 'CHAPTERS' : key === 'created' ? 'CREATED_AT' : 'POPULARITY_SCORE';
  return `orderBy: { field: ${field} direction: ${direction} }`;
}

export interface SenkuroFilters {
  senkuroOrdering?: string;
  senkuroStatuses?: string[];
  senkuroTypes?: string[];
  senkuroFormats?: string[];
  senkuroRatings?: string[];
  senkuroSources?: string[];
  senkuroTranslation?: string[];
  senkuroCountries?: string[];
  senkuroLabels?: string[];
  senkuroChaptersFrom?: number;
  senkuroChaptersTo?: number;
  senkuroYearFrom?: number;
  senkuroYearTo?: number;
}

/** The API takes filter OBJECTS (`{include: [...]}`), not the comma-joined
 * scalars the first implementation sent — those were rejected with
 * "Expected input type MangaStatusFilter" and every filtered search failed.
 * Exported so the argument shapes stay unit-tested. */
export function buildSenkuroFilterParts(f: SenkuroFilters | undefined): string[] {
  const parts: string[] = [];
  const enumFilter = (arg: string, values?: string[]): void => {
    const list = (values ?? []).map((v) => v.trim()).filter(Boolean);
    if (list.length > 0) parts.push(`${arg}: {include: [${list.join(', ')}]}`);
  };
  const stringFilter = (arg: string, values?: string[]): void => {
    const list = (values ?? []).map((v) => v.trim()).filter(Boolean);
    if (list.length > 0) parts.push(`${arg}: {include: [${list.map((v) => JSON.stringify(v)).join(', ')}]}`);
  };
  enumFilter('status', f?.senkuroStatuses);
  enumFilter('type', f?.senkuroTypes);
  enumFilter('format', f?.senkuroFormats);
  enumFilter('rating', f?.senkuroRatings);
  enumFilter('source', f?.senkuroSources);
  enumFilter('translitionStatus', f?.senkuroTranslation);
  stringFilter('originCountry', f?.senkuroCountries);
  stringFilter('label', f?.senkuroLabels);
  const positive = (v: number | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
  const cf = positive(f?.senkuroChaptersFrom);
  const ct = positive(f?.senkuroChaptersTo);
  if (cf !== null || ct !== null) {
    parts.push(`chapters: {${cf !== null ? `start: ${cf}` : ''}${cf !== null && ct !== null ? ' ' : ''}${ct !== null ? `end: ${ct}` : ''}}`);
  }
  const yf = positive(f?.senkuroYearFrom);
  const yt = positive(f?.senkuroYearTo);
  if (yf !== null || yt !== null) {
    const start = yf !== null ? `start: "${yf}-01-01"` : '';
    const end = yt !== null ? `end: "${yt}-12-31"` : '';
    parts.push(`releasedOn: {${start}${start && end ? ' ' : ''}${end}}`);
  }
  return parts;
}

/** Senkognito (the 18+ Senkuro frontend) is a separate GraphQL app: same
 * account/token, different App-Id and its OWN persisted `fetchMangas`
 * operation. The main Senkuro API hides EXPLICIT works entirely (0 results),
 * so 18+ searches must go here. */
const SENKOGNITO_GRAPHQL = 'https://api.senkognito.com/graphql';
const SENKOGNITO_APP_ID = '5033164800100';
const SENKOGNITO_APP_VERSION = '201126';
const SENKOGNITO_FETCH_MANGAS_HASH = '125525d81baea4e40cb92b0824444673215ca2c248b054b5f89668bfd0452898';

/** The only Senkuro rating that is R34 (18+). QUESTIONABLE is 16+ and stays
 * out of the app's R34 category. */
export function senkuroAdultFromRating(rating: unknown): boolean {
  return String(rating ?? '').toUpperCase() === 'EXPLICIT';
}

function senkuroOrderVars(ordering?: string): { field: string; direction: 'ASC' | 'DESC' } {
  const raw = ordering?.trim() ?? '';
  const key = raw.replace(/^-/, '') || 'popularity';
  const field =
    key === 'score' ? 'SCORE' : key === 'views' ? 'VIEWS' : key === 'chapters' ? 'CHAPTERS' : key === 'created' ? 'CREATED_AT' : 'POPULARITY_SCORE';
  // Matches senkuroOrderPart(): '-' = descending, a bare field = ascending,
  // no ordering = the site's default (popularity, descending).
  const direction: 'ASC' | 'DESC' = raw && !raw.startsWith('-') ? 'ASC' : 'DESC';
  return { field, direction };
}

function filterVars(values?: string[]): { include: string[]; exclude: string[] } {
  return { include: (values ?? []).map((v) => v.trim()).filter(Boolean), exclude: [] };
}

/** Variables of Senkognito's persisted `fetchMangas` operation. Exported for
 * tests (filter/ordering mapping is easy to break silently). */
export function buildSenkognitoVars(
  query: string,
  filters: SenkuroFilters | undefined,
  after?: string,
): Record<string, unknown> {
  const positive = (v: number | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
  const cf = positive(filters?.senkuroChaptersFrom);
  const ct = positive(filters?.senkuroChaptersTo);
  const yf = positive(filters?.senkuroYearFrom);
  const yt = positive(filters?.senkuroYearTo);
  const order = senkuroOrderVars(filters?.senkuroOrdering);
  return {
    after: after ?? null,
    bookmarkCollections: { include: [], exclude: [] },
    chapters: cf !== null || ct !== null ? { ...(cf !== null ? { start: cf } : {}), ...(ct !== null ? { end: ct } : {}) } : {},
    format: filterVars(filters?.senkuroFormats),
    label: filterVars(filters?.senkuroLabels),
    orderDirection: order.direction,
    orderField: order.field,
    originCountry: filterVars(filters?.senkuroCountries),
    rating: filterVars(filters?.senkuroRatings),
    releasedOn: yf !== null || yt !== null ? { ...(yf !== null ? { start: `${yf}-01-01` } : {}), ...(yt !== null ? { end: `${yt}-12-31` } : {}) } : {},
    search: query.trim() || null,
    source: filterVars(filters?.senkuroSources),
    status: filterVars(filters?.senkuroStatuses),
    translitionStatus: filterVars(filters?.senkuroTranslation),
    type: filterVars(filters?.senkuroTypes),
  };
}

function senkognitoToken(cookieHeader: string): string {
  return (
    cookieHeader
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('access_token='))
      ?.slice('access_token='.length) ?? ''
  );
}

/** One page (20 works) of Senkognito's catalogue, explicit content included. */
export async function fetchSenkognitoMangas(
  query: string,
  filters: SenkuroFilters | undefined,
  after: string | undefined,
  cookieHeader: string,
  proxy?: string,
): Promise<CatalogItem[]> {
  const token = senkognitoToken(cookieHeader);
  const json = (await httpPostJson(
    SENKOGNITO_GRAPHQL,
    JSON.stringify({
      extensions: { persistedQuery: { sha256Hash: SENKOGNITO_FETCH_MANGAS_HASH, version: 1 } },
      operationName: 'fetchMangas',
      variables: buildSenkognitoVars(query, filters, after),
    }),
    {
      'Content-Type': 'application/json',
      'App-Id': SENKOGNITO_APP_ID,
      'App-Version': SENKOGNITO_APP_VERSION,
      Origin: 'https://senkognito.com',
      Referer: 'https://senkognito.com/browse/manga',
      Accept: 'application/graphql-response+json, application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    proxy,
  )) as any;
  const err = json?.errors?.[0]?.message;
  if (err) throw new Error(String(err));
  const conn = json?.data?.mangas;
  const edges: any[] = conn?.edges ?? [];
  const endCursor: string | null = typeof conn?.pageInfo?.endCursor === 'string' ? conn.pageInfo.endCursor : null;
  // The persisted fetchMangas query does not expose labels, so resolve the
  // NSFW signal (hentai/smut) in one extra batched request. Missing slugs fall
  // back to the age rating (privacy-safe: an unresolved card stays hidden when
  // R34 is off).
  const slugs: string[] = edges.map((e) => String(e?.node?.slug ?? '')).filter(Boolean);
  let flags = new Map<string, boolean>();
  if (slugs.length > 0) {
    try {
      flags = await fetchSenkuroR34Flags(slugs, { cookieHeader, proxy });
    } catch {
      /* fall back to the rating */
    }
  }
  return edges.map((e) => {
    const n = e?.node ?? {};
    const titles: any[] = Array.isArray(n?.titles) ? n.titles : [];
    const title =
      titles.find((t) => t?.lang === 'RU')?.content ??
      titles.find((t) => t?.lang === 'EN')?.content ??
      n?.originalName?.content ??
      'Без названия';
    const rating = String(n?.rating ?? '');
    return {
      url: `https://senkuro.me/manga/${n?.slug ?? ''}/`,
      title,
      coverUrl: n?.cover?.preview?.url ?? n?.cover?.original?.url ?? null,
      pages: null,
      kind: SK_KIND.get(String(n?.type ?? '')) ?? null,
      score: typeof n?.score === 'number' ? n.score : null,
      status: SK_STATUS_LABELS.get(String(n?.status ?? '')) ?? null,
      adult: flags.has(String(n?.slug ?? '')) ? flags.get(String(n?.slug ?? '')) === true : senkuroAdultFromRating(rating),
      tags: [],
      // Senkognito returns the page cursor at pageInfo level, not per edge:
      // repeat it on the cards so the catalog's forward-only cursor works.
      cursor: endCursor,
    };
  });
}
const searchCache = new SwrCache<CatalogItem[]>(120_000, 40);

export async function searchSenkuro(
  query: string,
  cookieHeader = '',
  after?: string,
  filters?: SenkuroFilters,
  proxy?: string,
): Promise<CatalogItem[]> {
  const key = [
    'sk',
    query,
    after ?? '',
    JSON.stringify(filters ?? {}),
    createHash('sha1').update(cookieHeader).digest('hex').slice(0, 10),
  ].join('|');
  return searchCache.get(key, async () => {
  // 18+ lives on Senkognito, not in the main Senkuro catalogue. Route those
  // searches to its own persisted operation (the main API always answers 0).
  if ((filters?.senkuroRatings ?? []).some((r) => r.toUpperCase() === 'EXPLICIT')) {
    try {
      return await fetchSenkognitoMangas(query, filters, after, cookieHeader, proxy);
    } catch (e) {
      logger.warn('[senkuro] Senkognito 18+ catalogue failed:', (e as Error)?.message ?? e);
      throw new Error(`Senkuro 18+: каталог Senkognito недоступен (${(e as Error)?.message ?? e})`);
    }
  }
  const searchPart = query.trim() ? `search: ${JSON.stringify(query.trim())}` : '';
  const afterPart = after ? `after: ${JSON.stringify(after)}` : '';
  const filterParts = buildSenkuroFilterParts(filters);
  // Text search goes through the new localized endpoint; filters/pagination
  // keep the old GraphQL catalog (which supports them).
  if (query.trim() && filterParts.length === 0 && !after) {
    try {
      return await fetchSenkuroSearchPage(query, proxy);
    } catch {
      /* fall back to the catalog search below */
    }
  }
  const parts = [searchPart, ...filterParts, afterPart].filter(Boolean);
  const orderPart = senkuroOrderPart(filters?.senkuroOrdering);
  const gql = JSON.stringify({
    query: `query { mangas(first: 30 ${parts.join(' ')} ${orderPart}) { edges { node { id slug titles { lang content } type status score rating labels { slug } cover { original { url } } } cursor } pageInfo { endCursor } } }`,
  });
  const headers: Record<string, string> = {
    ...senkuroHeaders(cookieHeader),
    Referer: 'https://senkuro.me/browse/manga',
  };
  const json = (await httpPostJson(SENKURO_GRAPHQL, gql, headers, proxy)) as any;
  const edges: any[] = json?.data?.mangas?.edges ?? [];
  const items = edges.map((e) => {
    const n = e?.node ?? {};
    const title =
      n?.titles?.find((t: any) => t?.lang === 'RU')?.content ?? n?.titles?.find((t: any) => t?.lang === 'EN')?.content ?? 'Без названия';
    const rawType = n?.type ?? '';
    const kind =
      rawType === 'MANGA' || rawType === 'RU_MANGA' || rawType === 'OEL_MANGA'
        ? 'Манга'
        : rawType === 'MANHWA'
          ? 'Манхва'
          : rawType === 'MANHUA'
            ? 'Маньхуа'
            : rawType === 'COMICS'
              ? 'Комикс'
              : rawType || null;
    return {
      url: `https://senkuro.me/manga/${n?.slug ?? ''}/`,
      title,
      coverUrl: n?.cover?.original?.url ?? null,
      pages: null,
      kind,
      score: typeof n?.score === 'number' ? n.score : null,
      // `labels` come back as slugs (drama, slice_of_life, …) — turn them into
      // readable tag chips.
      tags: (Array.isArray(n?.labels) ? n.labels : [])
        .map((l: any) => String(l?.slug ?? '').replace(/_/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 40),
      // `rating` is the site's age rating enum (SAFE/SENSITIVE/QUESTIONABLE/
      // EROTIC) — only the explicit one is 18+.
      adult: senkuroLabelsAreR34(n?.labels),
      // Publication status comes as an enum (ANNOUNCE/ONGOING/FINISHED/…);
      // the UI shows the Russian label from SENKURO_STATUS.
      status: SK_STATUS_LABELS.get(String(n?.status ?? '')) ?? null,
      cursor: typeof e?.cursor === 'string' ? e.cursor : null,
    };
  });
  if (items.length === 0) {
    // A filtered request legitimately returns nothing (e.g. a narrow label combo).
    // no works, or a label combination is too narrow) — do NOT claim the cookies
    // are stale and drop the source into an error state.
    const hasFilters = buildSenkuroFilterParts(filters).length > 0 || query.trim().length > 0;
    if (hasFilters) return [];
    // Anonymous requests always get an EMPTY catalog; authorized ones fill it.
    if (!cookieHeader.trim()) {
      throw new Error(
        'Senkuro: сайт отдаёт каталог только авторизованным. Открой Настройки → «Войти в Senkuro» — куки соберутся автоматически.',
      );
    }
    throw new Error('Senkuro: каталог пуст — куки устарели или не те. Повтори вход в Настройках («Войти в Senkuro»).');
  }
  return items;
  });
}

/** Manga slug from a Senkuro manga or chapter URL (`…/manga/<slug>/…`). */
export function senkuroMangaSlugFromUrl(url: string): string | null {
  const m = url.match(/senkuro\.[a-z]+\/manga\/([^/?#]+)/i);
  return m ? m[1] : null;
}

/** Series URL for a chapter URL: `…/manga/<slug>/chapter/<id>` → `…/manga/<slug>/`.
 * Without it the library stored the CHAPTER url as seriesId, and the chapter
 * list tried `manga(slug: <chapterId>)` — hence "не удалось определить ветку". */
export function senkuroSeriesUrlFromChapterUrl(url: string): string | null {
  const slug = senkuroMangaSlugFromUrl(url);
  if (!slug) return null;
  const base = url.includes('senkuro.com') ? 'https://senkuro.com' : 'https://senkuro.me';
  return `${base}/manga/${slug}/`;
}

const mangaTitleCache = new Map<string, string>();
const MANGA_TITLE_CACHE_MAX = 200;

/** Work title (RU preferred) for a manga slug. Senkuro chapter nodes carry only
 * a chapter NAME ("1", "3", "0" for these titles), so using it as the gallery
 * title made History/Library rows look like "1" instead of the work name. */
export async function fetchSenkuroMangaTitle(mangaSlug: string, cookieHeader = '', proxy?: string): Promise<string> {
  const cached = mangaTitleCache.get(mangaSlug);
  if (cached) return cached;
  const gql = JSON.stringify({
    query: `query { manga(slug: "${mangaSlug}") { titles { lang content } } }`,
  });
  const json = (await httpPostJson(
    SENKURO_GRAPHQL,
    gql,
    { ...senkuroHeaders(cookieHeader), Referer: `https://senkuro.me/manga/${mangaSlug}/` },
    proxy,
    30_000,
  )) as any;
  const titles: any[] = json?.data?.manga?.titles ?? [];
  const pick = (lang: string): string => String(titles.find((t) => t?.lang === lang)?.content ?? '').trim();
  const title = pick('RU') || pick('EN') || String(titles[0]?.content ?? '').trim();
  if (title) {
    if (mangaTitleCache.size >= MANGA_TITLE_CACHE_MAX) {
      const oldest = mangaTitleCache.keys().next().value;
      if (oldest !== undefined) mangaTitleCache.delete(oldest);
    }
    mangaTitleCache.set(mangaSlug, title);
  }
  return title;
}

export async function fetchSenkuroChapters(
  mangaSlug: string,
  cookieHeader = '',
  proxy?: string,
): Promise<{ chapters: ChapterInfo[]; mangaTitle: string }> {
  const mangaGql = JSON.stringify({
    query: `query { manga(slug: "${mangaSlug}") { id branches { id } titles { lang content } } }`,
  });
  let mangaJson: any = null;
  // One retry: the GraphQL endpoint occasionally answers an empty `manga` under
  // Tor load, which surfaced as a raw "не удалось определить ветку" in the UI.
  for (let attempt = 0; attempt < 2; attempt++) {
    mangaJson = await httpPostJson(
      SENKURO_GRAPHQL,
      mangaGql,
      {
        ...senkuroHeaders(cookieHeader),
        Referer: `https://senkuro.me/manga/${mangaSlug}/chapters`,
      },
      proxy,
    );
    if (mangaJson?.data?.manga) break;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
  }
  const branchId: string = String(mangaJson?.data?.manga?.branches?.[0]?.id ?? '');
  if (!branchId) {
    throw new Error(
      'Senkuro: сайт не отдал список глав (пустой ответ). Повтори через пару секунд; если не помогает — обнови вход в Senkuro в настройках.',
    );
  }
  const mainName: string =
    String(mangaJson?.data?.manga?.titles?.find((t: any) => t?.lang === 'RU')?.content ?? '').trim() ||
    String(mangaJson?.data?.manga?.titles?.[0]?.content ?? '').trim();
  if (mainName) mangaTitleCache.set(mangaSlug, mainName);

  const all: ChapterInfo[] = [];
  let cursor: string | null = null;
  for (;;) {
    const after = cursor ? `"${cursor}"` : 'null';
    const gql = JSON.stringify({
      query: `query { mangaChapters(first: 100, branchId: "${branchId}", after: ${after}, orderBy: { field: NUMBER, direction: ASC }) { edges { node { id slug name number volume } } pageInfo { endCursor hasNextPage } } }`,
    });
    const json = (await httpPostJson(
      SENKURO_GRAPHQL,
      gql,
      { ...senkuroHeaders(cookieHeader), Referer: 'https://senkuro.me/' },
      proxy,
      30_000,
    )) as any;
    const data = json?.data?.mangaChapters;
    for (const edge of data?.edges ?? []) {
      const node = edge?.node ?? {};
      const slug: string = node.slug ?? '';
      // `number`/`volume` come back as STRINGS ("1") — the site's API, despite
      // the GraphQL scalar, does not coerce to Int. Map whatever we get.
      const chapter_num = senkuroChapterNumber(node.number, node.volume);
      const name: string | null = typeof node.name === 'string' && node.name ? node.name : null;
      all.push({
        // The site moved chapter pages from /chapter/<slug> to
        // /chapters/<slug>/pages/<n> (the old form now 404s).
        chapter_id: `https://senkuro.me/manga/${mangaSlug}/chapters/${slug}/pages/1`,
        chapter_num,
        title: name ?? (chapter_num ? null : mainName),
        lang: 'senkuro',
      });
    }
    const nextCursor = typeof data?.pageInfo?.endCursor === 'string' ? data.pageInfo.endCursor : null;
    // A missing cursor with hasNextPage=true re-requested the SAME page forever
    // ("Загружаю список глав…" never finished, with continuous GraphQL spam).
    if (!data?.pageInfo?.hasNextPage || !nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (all.length === 0) throw new Error('Senkuro: список глав пуст');
  return { chapters: all, mangaTitle: mainName };
}

export async function fetchSenkuroChapter(
  chapterUrl: string,
  cookieHeader = '',
  proxy?: string,
): Promise<{ title: string; chapterLabel: string; pageUrls: string[]; base: string }> {
  // Both URL forms: old /chapter/<slug> and current /chapters/<slug>/pages/<n>.
  const slug = chapterUrl.match(/\/chapters?\/([^/?#]+)/i)?.[1] ?? chapterUrl.trim().replace(/\/+$/, '').split('/').pop() ?? '';
  if (!slug) throw new Error('Senkuro: не удалось разобрать slug главы');
  const base = chapterUrl.includes('senkuro.com') ? 'https://senkuro.com' : 'https://senkuro.me';
  const gql = JSON.stringify({
    query: `query { mangaChapter(slug: "${slug}") { id name number volume pages { number image { original { url } compress: resize(width: 1200, quality: 80, format: WEBP) { url } } } } }`,
  });
  // The chapter-page GraphQL is served like the rest of senkuro.me — the
  // bearer token (from the session cookie) must travel along, or authorized
  // content returns empty/restricted.
  const json = (await httpPostJson(SENKURO_GRAPHQL, gql, { ...senkuroHeaders(cookieHeader), Referer: `${base}/`, Origin: base }, proxy)) as any;
  const chapter = json?.data?.mangaChapter;
  const pages: any[] = chapter?.pages ?? [];
  const pageUrls: string[] = [];
  for (const p of pages) {
    const u = p?.image?.compress?.url ?? p?.image?.original?.url;
    if (typeof u === 'string') pageUrls.push(u);
  }
  if (pageUrls.length === 0) {
    // The chapter-page query answers `mangaChapter: null` for a missing/expired
    // chapter (site re-created chapters, or the session lost access). Say what
    // the user can do instead of the old bare "не удалось извлечь URL страниц".
    throw new Error(
      'Senkuro: сайт не отдал страницы главы. Обнови вход в Senkuro (Настройки → «Войти в Senkuro») и открой главу из списка «Главы» — старые ссылки сайт иногда заменяет.',
    );
  }
  // The chapter NAME is just its number for these titles ("1", "3", "0"): it
  // became the gallery title and every History/Library card read "1". Fetch the
  // WORK title and keep the chapter label separate.
  const chapterLabel =
    typeof chapter?.name === 'string' && chapter.name ? chapter.name : senkuroChapterNumber(chapter?.number, chapter?.volume) || slug;
  const mangaSlug = senkuroMangaSlugFromUrl(chapterUrl);
  let mangaTitle = '';
  if (mangaSlug) {
    try {
      mangaTitle = await fetchSenkuroMangaTitle(mangaSlug, cookieHeader, proxy);
    } catch {
      /* title is cosmetic — keep the chapter label */
    }
  }
  return { title: mangaTitle || chapterLabel, chapterLabel, pageUrls, base };
}

/** Full label dictionary for the filter panel (slug + Russian title). The API
 * has no "search" argument and returns at most 100 labels per page, so the whole
 * dictionary is fetched once (≈12 pages, ~1100 labels) and cached for 12 hours.
 * `titles` carries RU/EN names; the site's chips use the same RU strings. */
let senkuroLabelsCache: { at: number; items: { slug: string; name: string }[] } | null = null;

export async function fetchSenkuroLabels(
  cookieHeader = '',
  proxy?: string,
): Promise<{ slug: string; name: string }[]> {
  if (senkuroLabelsCache && Date.now() - senkuroLabelsCache.at < 12 * 60 * 60_000) return senkuroLabelsCache.items;
  const items: { slug: string; name: string }[] = [];
  let after = '';
  for (let page = 0; page < 40; page++) {
    const afterPart = after ? `, after: ${JSON.stringify(after)}` : '';
    const gql = JSON.stringify({
      query: `query { labels(first: 100${afterPart}) { edges { node { slug titles { lang content } } } pageInfo { endCursor hasNextPage } } }`,
    });
    const json = (await httpPostJson(
      SENKURO_GRAPHQL,
      gql,
      { ...senkuroHeaders(cookieHeader), Referer: 'https://senkuro.me/browse/manga' },
      proxy,
    )) as any;
    const edges: any[] = json?.data?.labels?.edges ?? [];
    for (const e of edges) {
      const titles: any[] = e?.node?.titles ?? [];
      const name =
        titles.find((t) => t?.lang === 'RU')?.content ?? titles.find((t) => t?.lang === 'EN')?.content ?? e?.node?.slug ?? '';
      if (e?.node?.slug) items.push({ slug: e.node.slug, name: String(name) });
    }
    const info = json?.data?.labels?.pageInfo;
    if (!info?.hasNextPage || !info?.endCursor || edges.length === 0) break;
    after = info.endCursor;
  }
  if (items.length > 0) senkuroLabelsCache = { at: Date.now(), items };
  return items;
}

/**
 * The NEW site (ne.senkuro.com) searches through a persisted GraphQL operation
 * on api.senkuro.com that matches RUSSIAN titles too. The old `mangas(search:)`
 * on api.senkuro.me only matched English slugs, so searching «копи» in the
 * catalog returned nothing. The operation returns a fixed first page (10 rows,
 * no cursor), which is exactly what the site's own search overlay shows.
 */
const SENKURO_SEARCH_HASH = '43cdedb6f6d2c0bba04815c4e6822558c37f655976cb6bc722361f71905bf5fd';

export async function fetchSenkuroSearchPage(query: string, proxy?: string): Promise<CatalogItem[]> {
  const json = (await httpPostJson(
    'https://api.senkuro.com/graphql',
    JSON.stringify({
      extensions: { persistedQuery: { sha256Hash: SENKURO_SEARCH_HASH, version: 1 } },
      operationName: 'search',
      variables: { query: query.trim(), type: 'MANGA' },
    }),
    {
      'App-Id': '4026531840100',
      'App-Version': '201126',
      Origin: 'https://ne.senkuro.com',
      Referer: 'https://ne.senkuro.com/',
      Accept: 'application/graphql-response+json, application/json',
    },
    proxy,
  )) as any;
  const edges: any[] = json?.data?.search?.edges ?? [];
  return edges.map((e) => {
    const n = e?.node ?? {};
    const titles: any[] = n?.titles ?? [];
    const title =
      titles.find((t) => t?.lang === 'RU')?.content ?? titles.find((t) => t?.lang === 'EN')?.content ?? n?.originalName ?? 'Без названия';
    return {
      url: `https://senkuro.me/manga/${n?.slug ?? ''}/`,
      title,
      coverUrl: n?.cover?.preview?.url ?? n?.cover?.original?.url ?? null,
      pages: null,
      kind: SK_KIND.get(String(n?.mangaType ?? '')) ?? null,
      score: typeof n?.score === 'number' ? n.score : null,
      status: SK_STATUS_LABELS.get(String(n?.mangaStatus ?? '')) ?? null,
    };
  });
}