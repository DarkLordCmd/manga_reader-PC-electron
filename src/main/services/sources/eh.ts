import * as cheerio from 'cheerio';
import { httpFetch, httpPostJson, warmTorCircuits } from '../http';
import { ehBlockedMessage } from '../eh-limits-hook';
import { rotateTorExit } from '../tor-embedded';
import { logger } from '../logger';
import { type CatalogItem, resolve, UA, TOR_UA } from './catalog-types';
import { assertLayout } from '../layout-watcher';

export function looksRateLimited(status: number, html: string): boolean {
  if (status === 403 || status === 429) return true;
  const lower = html.toLowerCase();
  return [
    'temporarily banned due to an excessive request rate',
    'you have been temporarily banned',
    'your ip address has been banned',
    'excessive request rate',
  ].some((m) => lower.includes(m));
}

/** Maps E-Hentai/ExHentai responses to user-friendly errors (same checks as JHenTai). */
export function ehErrorFromResponse(status: number, text: string): string | null {
  const blockedMsg = ehBlockedMessage();
  if (blockedMsg) return blockedMsg;
  if (status === 403) return 'Cloudflare блокирует запрос (403). Попробуй другой IP/VPN или подожди.';
  if (status === 429) return 'Слишком много запросов (429). Подожди минуту-другую.';
  if (!text || text.trim().length === 0) {
    return 'Сервер ответил пустым телом — похоже, IP забанен на ExHentai (sad panda) или запрос блокируется анти-ботом.';
  }
  if (text.startsWith('Your IP address') || text.startsWith('This IP address')) {
    const first = text.split('\n')[0].trim();
    return `IP забанен: ${first}`;
  }
  if (text.startsWith('You have exceeded your image')) {
    return 'Превышен лимит просмотра изображений на E-Hentai. Подожди до сброса лимита.';
  }
  if (text.includes('Page load has been aborted due to a fatal error')) {
    return 'Внутренняя ошибка сервера E-Hentai. Попробуй ещё раз позже.';
  }
  // JHenTai distinguishes a removed gallery from a generic 404: the page body
  // carries an explanation. A bare "Not Found" (wrong URL) must not be reported
  // as a deleted gallery.
  if (status === 404 || /gallery not found|this gallery has been (removed|deleted|expunged)|gallery is unavailable/i.test(text)) {
    if (!/gallery|deleted|removed|expunged|unavailable/i.test(text)) {
      return 'E-Hentai: страница не найдена (404) — проверь адрес/фильтр.';
    }
    const hint = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    return `Галерея удалена, скрыта или недоступна${hint ? `: ${hint}` : ''}`;
  }
  return null;
}

export interface ExSearchResult extends CatalogItem {
  category: string | null;
  rating: number | null;
  chapterTotal: number | null;
  thumbUrl: string | null;
  tags?: string[];
}

/** Parses an E-Hentai/ExHentai listing page. Handles both the compact
 * listing (`.itg.gltc > tbody > tr`, JHenTai-style) and the thumbnail mode
 * (`.itg.gld > div`) that e-hentai serves with `inline_set=dm_t`. */
export function parseExHentaiListing(html: string, base: string): ExSearchResult[] {
  assertLayout(['itg', 'glink', '/g/'], html, 'E-Hentai list');
  const $ = cheerio.load(html);
  const results: ExSearchResult[] = [];
  const seen = new Set<string>();

  const push = (item: ExSearchResult): void => {
    if (seen.has(item.url)) return;
    seen.add(item.url);
    results.push(item);
  };

  const parseCover = ($el: cheerio.Cheerio<any>): string | null => {
    const img = $el.find('img').first();
    const cover = img.attr('data-src') || img.attr('src') || null;
    return cover ? resolve(base, cover) : null;
  };

  const parseTags = ($el: cheerio.Cheerio<any>): string[] => {
    const out: string[] = [];
    $el.find('.gt, .gtl').each((_j, t) => {
      const $t = $(t);
      const label = ($t.attr('title') || $t.text() || '').trim();
      if (label) out.push(label);
    });
    return [...new Set(out)].slice(0, 24);
  };

  // Compact rows: `.itg.gltc > tbody > tr`, each with `.gl3c.glname > a`,
  // `.glink` (title), `.cn` (category) and `.gl4c.glhide > div` (pages).
  $('table.itg tr').each((_i, el) => {
    const $el = $(el);
    const a = $el.find('.gl3c.glname a, td.glname a').first();
    const href = a.attr('href') ?? '';
    if (!href.includes('/g/')) return;
    const full = resolve(base, href);
    if (!full) return;
    const title = $el.find('.glink').first().text().trim() || a.text().trim() || (a.attr('title') ?? '');
    const pageDivs = $el.find('.gl4c.glhide > div');
    const pagesText = pageDivs.length >= 2 ? pageDivs.eq(1).text() : $el.text();
    const pagesM = pagesText.match(/(\d+)\s+(?:pages?|страниц)/i);
    const rowText = $el.text();
    const ratingM = rowText.match(/(\d(?:\.\d+)?)\s*\/\s*5/);
    push({
      url: full,
      title,
      coverUrl: parseCover($el),
      thumbUrl: null,
      category: $el.find('.cn').first().text().trim() || $el.find('td.glcat').first().text().trim() || null,
      rating: ratingM ? Number(ratingM[1]) : null,
      pages: pagesM ? Number(pagesM[1]) : null,
      tags: parseTags($el),
      chapterTotal: null,
    });
  });

  // Thumbnail mode: `.itg.gld > div` — each block has a `/g/` link,
  // `.glink` (title), `.cs` (category), cover and page count in `.gl5t`.
  if (results.length === 0) {
    $('.itg.gld > div').each((_i, el) => {
      const $el = $(el);
      const a = $el.find('a[href*="/g/"]').first();
      const href = a.attr('href') ?? '';
      if (!href.includes('/g/')) return;
      const full = resolve(base, href);
      if (!full) return;
      const title = $el.find('.glink').first().text().trim() || $el.find('.gl1t').first().text().trim() || a.text().trim() || '';
      const pagesM = $el.text().match(/(\d+)\s+(?:pages?|страниц)/i);
      const rowText = $el.text();
      const ratingM = rowText.match(/(\d(?:\.\d+)?)\s*\/\s*5/);
      push({
        url: full,
        title,
        coverUrl: parseCover($el),
        thumbUrl: null,
        category: $el.find('.cs').first().text().trim() || null,
        rating: ratingM ? Number(ratingM[1]) : null,
        pages: pagesM ? Number(pagesM[1]) : null,
        tags: parseTags($el),
        chapterTotal: null,
      });
    });
  }

  return results;
}

export function extractGid(url: string): string | null {
  const m = url.match(/\/g\/(\d+)\//);
  return m ? m[1] : null;
}

export function extractGidToken(url: string): { gid: string; token: string } | null {
  const m = url.match(/\/g\/(\d+)\/([0-9a-f]+)\/?/);
  return m ? { gid: m[1], token: m[2] } : null;
}

export interface GDataResult {
  gid: string;
  token: string;
  title: string;
  title_jpn?: string;
  category: string;
  thumb?: string;
  uploader: string;
  posted: string;
  filecount: string;
  filesize: number;
  expunged: boolean;
  rating: string;
  tags: string[];
  comment_count: number;
}

/**
 * E-Hentai/ExHentai JSON metadata API (same as JHenTai's requestGalleryMetadatas):
 * POST api.php with `{ method: 'gdata', gidlist: [[gid, token], ...], namespace: 1 }`.
 * Batching is capped at 25 per request.
 */
export async function fetchGData(
  list: { gid: string; token: string }[],
  opts: { apiBase?: string; cookieHeader?: string; proxy?: string; timeoutMs?: number } = {},
): Promise<GDataResult[]> {
  if (list.length === 0) return [];
  const apiBase = opts.apiBase ?? 'https://exhentai.org/api.php';
  const out: GDataResult[] = [];
  for (let i = 0; i < list.length; i += 25) {
    const batch = list.slice(i, i + 25);
    const json = (await httpPostJson(
      apiBase,
      JSON.stringify({ method: 'gdata', gidlist: batch.map((b) => [b.gid, b.token]), namespace: 1 }),
      { 'Content-Type': 'application/json', ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {}) },
      opts.proxy,
      opts.timeoutMs ?? 20_000,
    )) as any;
    const arr: any[] = json?.gmetadata ?? [];
    for (const m of arr) {
      out.push({
        gid: String(m?.gid ?? ''),
        token: String(m?.token ?? ''),
        title: m?.title ?? '',
        title_jpn: m?.title_jpn,
        category: m?.category ?? '',
        thumb: m?.thumb,
        uploader: m?.uploader ?? '',
        posted: m?.posted ?? '',
        filecount: String(m?.filecount ?? ''),
        filesize: m?.filesize ?? 0,
        expunged: !!m?.expunged,
        rating: m?.rating ?? '',
        tags: Array.isArray(m?.tags) ? m.tags : [],
        comment_count: m?.comment_count ?? 0,
      });
    }
  }
  return out;
}

export function buildEhSearchParams(opts: {
  query: string;
  excludedCats?: number;
  minRating?: number;
  inlineSet?: boolean;
  /** EH "Watched" only (f_sh=1). */
  watchedOnly?: boolean;
  cursor?: { dir: 'next' | 'prev'; gid: string };
}): string[] {
  const params: string[] = [];
  if (opts.query.trim()) params.push(`f_search=${encodeURIComponent(opts.query)}`);
  const cats = opts.excludedCats ?? 0;
  if (cats > 0) params.push(`f_cats=${cats}`);
  if (opts.minRating && opts.minRating > 0) params.push(`f_srdd=${opts.minRating}`);
  if (opts.watchedOnly) params.push('f_sh=1');
  if (opts.inlineSet) params.push('inline_set=dm_t');
  if (opts.cursor) params.push(`${opts.cursor.dir}=${opts.cursor.gid}`);
  return params;
}

export async function searchExHentai(
  query: string,
  opts: {
    cookieHeader: string;
    torSocksAddr: string;
    proxyAddr?: string;
    useOnion: boolean;
    page?: number;
    forceTor?: boolean;
    excludedCats?: number;
    minRating?: number;
    watchedOnly?: boolean;
    /** Toplist period in days (7/31/365) — switches the page to toplist.php. */
    toplist?: number;
    domainOverride?: string;
    cursor?: { dir: 'next' | 'prev'; gid: string };
  },
  exProxy?: string,
): Promise<ExSearchResult[]> {
  const useProxy = opts.useOnion || opts.forceTor;
  const proxy = exProxy ?? (useProxy ? opts.torSocksAddr : undefined);
  const ua = useProxy ? TOR_UA : UA;
  const base = opts.domainOverride
    ? opts.domainOverride
    : opts.useOnion
      ? 'http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion'
      : 'https://exhentai.org';

  const params = buildEhSearchParams({
    query,
    excludedCats: opts.excludedCats ?? 0,
    minRating: opts.minRating,
    watchedOnly: opts.watchedOnly,
    inlineSet: !!opts.domainOverride,
    cursor: opts.cursor,
  });
  // Toplist is a separate page with the same card markup; the query/filters do
  // not apply there, so it replaces (not extends) the search URL. Only
  // e-hentai.org serves toplists (exhentai.org answers 404) and the onion mirror
  // answers an empty body — which used to be misread as "session expired".
  // Real ids: 11 all-time, 12 past year, 13 past month, 15 yesterday.
  const TOPLIST_IDS = new Set([11, 12, 13, 15]);
  const toplist = opts.toplist && TOPLIST_IDS.has(opts.toplist) && !opts.useOnion ? opts.toplist : 0;
  const url =
    toplist > 0
      ? `https://e-hentai.org/toplist.php?tl=${toplist}&p=${Math.max(0, opts.page ?? 0)}`
      : params.length
        ? `${base}/?${params.join('&')}`
        : `${base}/`;

  return await ehFetchListing(url, base, {
    cookieHeader: opts.cookieHeader,
    proxy,
    ua,
    gdataApiBase: opts.domainOverride ? 'https://api.e-hentai.org/api.php' : 'https://exhentai.org/api.php',
  });
}

/** E-Hentai bans an IP for "excessive request rate" when listing requests come
 * in bursts; through Tor the exit IP is shared and trips it even faster. All
 * listing fetches are serialized with a minimum gap, and a rate-limit answer
 * starts a cooldown during which we do not touch the site at all (otherwise the
 * user's immediate retries only extend the ban). */
const EH_LISTING_MIN_GAP_MS = 3000;
const EH_RATE_LIMIT_COOLDOWN_MS = 120_000;
let ehListingChain: Promise<unknown> = Promise.resolve();
let ehLastListingAt = 0;
let ehCooldownUntil = 0;

/** E-Hentai's ban page states the exact remaining time:
 * "The ban expires in 13 minutes and 50 seconds" (also hours / seconds). */
export function parseEhBanSeconds(text: string): number | null {
  const m = text.match(/ban expires in ([^.<]+)/i);
  if (!m) return null;
  const seg = m[1].toLowerCase();
  let sec = 0;
  const h = seg.match(/(\d+)\s*hour/);
  if (h) sec += Number(h[1]) * 3600;
  const mi = seg.match(/(\d+)\s*minute/);
  if (mi) sec += Number(mi[1]) * 60;
  const s = seg.match(/(\d+)\s*second/);
  if (s) sec += Number(s[1]);
  return sec > 0 ? sec : null;
}

function humanWait(sec: number): string {
  if (sec >= 3600) return `${Math.floor(sec / 3600)} ч ${Math.round((sec % 3600) / 60)} мин`;
  if (sec >= 60) return `${Math.floor(sec / 60)} мин ${sec % 60} с`.replace(' 0 с', '');
  return `${sec} с`;
}

export function ehListingCooldownLeftSec(): number {
  return Math.max(0, Math.ceil((ehCooldownUntil - Date.now()) / 1000));
}

/** A manual exit change makes the old ban irrelevant (it followed the previous
 * IP), so drop the cooldown and let the user retry immediately. */
export function resetEhCooldown(): void {
  ehCooldownUntil = 0;
  lastRotateRoundAt = 0;
}

/** Thrown when E-Hentai answers with a rate-limit/ban page. Typed so the IPC
 * layer can react (switch the account for clearnet) instead of pattern-matching
 * a message. */
export class EhRateLimitError extends Error {}

function ehRateLimitError(): EhRateLimitError {
  const left = ehListingCooldownLeftSec();
  return new EhRateLimitError(
    left > 0
      ? `ExHentai временно заблокировал IP за частые запросы. Подожди ещё ${left} с — автоматические повторы остановлены.`
      : 'Сайт временно заблокировал IP за слишком частые запросы (excessive request rate). Подожди минуту-другую и попробуй снова.',
  );
}

function ehPaced<T>(fn: () => Promise<T>): Promise<T> {
  const run = ehListingChain.then(async () => {
    if (Date.now() < ehCooldownUntil) throw ehRateLimitError();
    // Jitter: a perfectly regular 2-second cadence is itself a fingerprint that
    // some ant-bot limiters look for.
    const wait = EH_LISTING_MIN_GAP_MS + Math.floor(Math.random() * 900) - (Date.now() - ehLastListingAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (Date.now() < ehCooldownUntil) throw ehRateLimitError();
    ehLastListingAt = Date.now();
    return fn();
  });
  ehListingChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** A rate-limit ban is per EXIT IP. Tor's NEWNYM alone often reuses the same
 * exit for the same destination, so `rotateTorExit` also blacklists the banned
 * relay (SETCONF ExcludeNodes) and waits for a genuinely different exit. One
 * rotation ROUND (up to two exits) is allowed per cooldown window — a permanent
 * ban must not turn into an endless circuit-hopping loop. */
let lastRotateRoundAt = 0;
function canRotateRound(): boolean {
  if (Date.now() - lastRotateRoundAt < EH_RATE_LIMIT_COOLDOWN_MS) return false;
  lastRotateRoundAt = Date.now();
  return true;
}

/** Listing results are cached: paging back, re-opening a filter combination or
 * a retry after a ban then costs no request at all. A stale entry is also served
 * when the site answers with a ban, so browsing does not dead-end. */
const EH_LISTING_CACHE_TTL_MS_DEFAULT = 5 * 60_000;
let ehListingCacheTtlMs = EH_LISTING_CACHE_TTL_MS_DEFAULT;

/** Configurable from settings: 0 disables the listing cache (every request goes
 * to the site), larger values mean fewer requests and more stale results. */
export function setEhListingCacheTtlMs(ms: number): void {
  ehListingCacheTtlMs = Math.max(0, Math.min(240 * 60_000, ms));
}
const EH_LISTING_CACHE_MAX = 80;
const ehListingCache = new Map<string, { at: number; items: ExSearchResult[] }>();
/** One background refresh per listing URL at a time. */
const ehRevalidating = new Set<string>();
/** Serve very old cache at once, but not forever: past this age the request
 * waits for the network (the listing may be days old and the pager stale). */
const EH_LISTING_STALE_MAX_MS = 24 * 60 * 60_000;

export type EhListingCacheDecision = 'fresh' | 'revalidate' | 'fetch';

/** Pure cache policy, exported for tests.
 * fresh — within TTL, no request at all;
 * revalidate — stale but young enough: return it now and refresh in background;
 * fetch — no cache, cache disabled, or the entry is too old. */
export function ehListingCacheDecision(
  ageMs: number | null,
  ttlMs: number,
  staleMaxMs: number = EH_LISTING_STALE_MAX_MS,
): EhListingCacheDecision {
  if (ageMs == null || ttlMs <= 0) return 'fetch';
  if (ageMs < ttlMs) return 'fresh';
  if (ageMs < staleMaxMs) return 'revalidate';
  return 'fetch';
}

function cacheListing(url: string, items: ExSearchResult[]): void {
  while (ehListingCache.size >= EH_LISTING_CACHE_MAX) {
    const oldest = ehListingCache.keys().next().value;
    if (oldest === undefined) break;
    ehListingCache.delete(oldest);
  }
  ehListingCache.set(url, { at: Date.now(), items });
}

async function ehFetchListing(
  url: string,
  base: string,
  o: { cookieHeader: string; proxy?: string; ua: string; gdataApiBase: string; gdataEnrich?: boolean },
): Promise<ExSearchResult[]> {
  const cached = ehListingCache.get(url);
  const age = cached ? Date.now() - cached.at : null;
  const decision = ehListingCacheDecision(age, ehListingCacheTtlMs);
  if (decision === 'fresh' && cached) return cached.items;

  // Stale-while-revalidate: a page/filter combination the user already visited
  // is shown INSTANTLY, while a single background request refreshes it for the
  // next visit. Re-opening a catalog page after the 5-minute TTL used to block
  // for 2-3 s (an onion listing request) before the same cards appeared.
  if (decision === 'revalidate' && cached) {
    if (!ehRevalidating.has(url)) {
      ehRevalidating.add(url);
      void ehFetchListingNow(url, base, o, cached)
        .catch((e) => logger.info('[eh] background listing refresh failed', (e as Error)?.message ?? e))
        .finally(() => ehRevalidating.delete(url));
    }
    return cached.items;
  }

  return ehFetchListingNow(url, base, o, cached);
}

async function ehFetchListingNow(
  url: string,
  base: string,
  o: { cookieHeader: string; proxy?: string; ua: string; gdataApiBase: string; gdataEnrich?: boolean },
  cached: { at: number; items: ExSearchResult[] } | undefined,
): Promise<ExSearchResult[]> {
  const attempt = () =>
    ehPaced(() =>
      httpFetch(
        {
          url,
          headers: {
            'User-Agent': o.ua,
            Referer: `${base}/`,
            Accept: 'text/html,application/xhtml+xml',
            ...(o.cookieHeader ? { Cookie: o.cookieHeader } : {}),
          },
          timeoutMs: o.proxy ? 120_000 : 30_000,
          frontOnEmpty: true,
        },
        o.proxy,
      ),
    );

  let r: Awaited<ReturnType<typeof attempt>>;
  try {
    r = await attempt();
  } catch (e) {
    // Network/cooldown failure: a listing the user saw minutes ago is still far
    // more useful than an error screen.
    if (cached) {
      logger.warn('[eh] listing failed — serving the cached copy');
      return cached.items;
    }
    throw e;
  }

  if (looksRateLimited(r.status, r.text)) {
    const banSec = parseEhBanSeconds(r.text);
    // Onion mirror: the ban follows the ACCOUNT/session, not the Tor exit — the
    // hidden service never sees our exit IP. Proof: the same onion URL answers
    // normally without the session cookie and with a ban page when it is sent.
    // Rotating exits there only wastes NEWNYM (and Tor rate-limits it), so report
    // the exact time and let the user switch the account or wait.
    if (/\.onion\b/i.test(url)) {
      const waitSec = Math.max(60, Math.min(banSec ?? EH_RATE_LIMIT_COOLDOWN_MS / 1000, 30 * 60));
      ehCooldownUntil = Date.now() + waitSec * 1000;
      if (cached) {
        logger.warn('[eh] onion session rate limited — serving the cached copy');
        return cached.items;
      }
      throw new EhRateLimitError(
        `ExHentai: бан привязан к аккаунту (сессии), а не к Tor-выходу — осталось ${humanWait(waitSec)}. ` +
          'Смена цепи не поможет: войди другим аккаунтом (Настройки → «Войти в ExHentai (onion)») или подожди.',
      );
    }
    let rotated = false;
    if (canRotateRound()) {
      // Clearnet exhentai/e-hentai: the limit is per IP, so hop across exits.
      for (let n = 0; n < 3 && looksRateLimited(r.status, r.text); n++) {
        const res = await rotateTorExit().catch(() => ({ changed: false, exit: null }));
        if (!res.changed) break;
        rotated = true;
        logger.info(`[eh] rate limited — rotated exit to ${res.exit ?? 'a new one'}, retrying`);
        // Tor tears the old circuits down first; give it time to build a fresh
        // one before the retry, otherwise the retry fails with a network error.
        await new Promise((res2) => setTimeout(res2, 2500));
        r = await attempt();
        if (o.proxy) warmTorCircuits(o.proxy, ['e-hentai.org', 'ehgt.org']);
      }
    }
    if (looksRateLimited(r.status, r.text)) {
      const waitSec = Math.max(60, Math.min(parseEhBanSeconds(r.text) ?? EH_RATE_LIMIT_COOLDOWN_MS / 1000, 30 * 60));
      ehCooldownUntil = Date.now() + waitSec * 1000;
      if (cached) {
        logger.warn('[eh] rate limited — serving the cached copy');
        return cached.items;
      }
      throw new EhRateLimitError(
        rotated
          ? `ExHentai: бан IP (${humanWait(waitSec)}) — выходной узел Tor сменён, но новый узел тоже забанен. Смени аккаунт в настройках или подожди.`
          : `ExHentai: сайт забанил IP за частые запросы — ${humanWait(waitSec)}. Подожди или смени цепь Tor в настройках.`,
      );
    }
  }
  const ehErr = ehErrorFromResponse(r.status, r.text);
  if (ehErr) throw new Error(`ExHentai: ${ehErr}`);
  if (r.status >= 400) throw new Error(`ExHentai: HTTP ${r.status}`);

  const results = parseExHentaiListing(r.text, base);
  if (results.length === 0) {
    const lower = r.text.toLowerCase();
    if (lower.includes('sad panda') || lower.includes('sorry, your ip') || lower.includes('ip has been banned')) {
      throw new Error('ExHentai: sad panda — аккаунт/IP без доступа к ExHentai или вход не выполнен');
    }
    if (!r.text.includes('table') && r.text.length < 4000)
      throw new Error('ExHentai: страница пуста или требует входа (sad panda / логин)');
    throw new Error('ExHentai: ничего не найдено (или куки не действительны / сайт изменил вёрстку)');
  }
  try {
    // Category, rating and page count are already parsed from the listing HTML
    // (parseExHentaiListing). The gdata call is a second request through Tor to
    // api.php and used to double the time of every filter change, so it is
    // opt-in only.
    if (o.gdataEnrich) {
      const meta = await fetchGData(
        results.map((x) => extractGidToken(x.url)).filter((x): x is { gid: string; token: string } => !!x),
        { apiBase: o.gdataApiBase, cookieHeader: o.cookieHeader, proxy: o.proxy, timeoutMs: o.proxy ? 120_000 : 20_000 },
      );
      const byGid = new Map(meta.map((m) => [m.gid, m]));
      for (const x of results) {
        const gid = extractGid(x.url);
        const m = gid ? byGid.get(gid) : undefined;
        if (!m) continue;
        if (m.category) x.category = m.category;
        const rc = Number(m.rating);
        if (!isNaN(rc) && rc > 0) x.rating = rc;
        const fc = Number(m.filecount);
        if (!isNaN(fc) && fc > 0) x.pages = fc;
      }
    }
  } catch {
    /* best-effort */
  }
  cacheListing(url, results);
  return results;
}

/** E-Hentai allows resetting the image-view limit from the home page: the site
 * itself renders a "Reset Limit" button that POSTs `reset_imagelimit`. JHenTai
 * does exactly this (EHRequest.requestResetImageLimit). The request still goes
 * through the same pacing/ban detection as every other EH call. */
export async function resetEhImageLimit(opts: {
  cookieHeader: string;
  proxy?: string;
  base?: string;
}): Promise<{ ok: boolean; message: string }> {
  const base = opts.base ?? 'https://e-hentai.org';
  const body = new URLSearchParams({ reset_imagelimit: 'Reset Limit' }).toString();
  const r = await ehPaced(() =>
    httpFetch(
      {
        url: `${base}/home.php`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': opts.proxy ? TOR_UA : UA,
          Referer: `${base}/home.php`,
          ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {}),
        },
        body,
        timeoutMs: opts.proxy ? 120_000 : 30_000,
      },
      opts.proxy,
    ),
  );
  if (looksRateLimited(r.status, r.text)) {
    const banSec = parseEhBanSeconds(r.text);
    if (banSec) ehCooldownUntil = Date.now() + Math.min(banSec, 30 * 60) * 1000;
    throw new EhRateLimitError('ExHentai: сброс лимита недоступен — сейчас действует бан. Повтори после истечения бана.');
  }
  const ehErr = ehErrorFromResponse(r.status, r.text);
  if (ehErr) throw new Error(`ExHentai: ${ehErr}`);
  if (r.status >= 400) throw new Error(`ExHentai: HTTP ${r.status} при сбросе лимита`);
  const text = r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const stillLimited = /exceeded your image/i.test(text);
  return {
    ok: !stillLimited,
    message: stillLimited
      ? 'Сайт не сбросил лимит (возможно, сброс уже использован в этом месяце).'
      : `Запрос на сброс отправлен. Ответ сайта: ${text.slice(0, 160) || '—'}`,
  };
}

export async function fetchEhPopular(
  source: 'ehentai' | 'exhentai' | 'exhentai_onion',
  opts: { cookieHeader: string; torSocksAddr: string; exProxyAddr?: string; torProxied: boolean },
): Promise<ExSearchResult[]> {
  const useOnion = source === 'exhentai_onion';
  const base = useOnion
    ? 'http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion'
    : source === 'ehentai'
      ? 'https://e-hentai.org'
      : 'https://exhentai.org';
  const useProxy = useOnion || opts.torProxied;
  const proxy = useProxy ? opts.torSocksAddr : opts.exProxyAddr?.trim() || undefined;
  const ua = useProxy ? TOR_UA : UA;
  return await ehFetchListing(`${base}/popular?inline_set=dm_t`, base, {
    cookieHeader: opts.cookieHeader,
    proxy,
    ua,
    gdataApiBase: source === 'ehentai' ? 'https://api.e-hentai.org/api.php' : 'https://exhentai.org/api.php',
  });
}
