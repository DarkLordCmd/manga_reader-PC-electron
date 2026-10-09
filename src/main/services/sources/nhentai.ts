import * as cheerio from 'cheerio';
import { httpFetch } from '../http';
import { fetchHtmlViaBrowser, fetchViaWindowFetchRetry } from '../browser-fetch';
import { type CatalogItem, resolve } from './catalog-types';
import { assertLayout } from '../layout-watcher';
import { detectsAntiBot } from '../anti-bot';
import { logger } from '../logger';

const T = (msg: string): void => {
  if (process.env.MR_LOG_TIMING) logger.info('[nh-timing]', new Date().toISOString().slice(11, 23), msg);
};

export function parseNhentaiPageCount(html: string): number | null {
  const words = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^\w:. ]/g, ' ')
    .split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i];
    const n = Number(w);
    const next = words[i + 1].toLowerCase();
    if (Number.isInteger(n) && (next === 'pages' || next === 'page')) return n;
  }
  const m = html.match(/pages?\s*[:]\s*(\d+)/i) || html.match(/[^a-z](\d+)\s+pages?/i);
  return m ? Number(m[1]) : null;
}

/** Hosts known to be behind an active Cloudflare wall (10 min TTL): while
 * active, skip the fast undici path (which gets a guaranteed 403) and go
 * straight to the Chennom browser channel. */
const cfWallUntil = new Map<string, number>();
function cfWallActive(host: string): boolean {
  const t = cfWallUntil.get(host);
  return !!t && t > Date.now();
}
function markCfWall(host: string): void {
  cfWallUntil.set(host, Date.now() + 10 * 60_000);
}

/**
 * Loads a nhentai page with resilience: fast HTTP path first; when
 * Cloudflare rejects the non-browser TLS handshake (403) or the network
 * fails, retries through the hidden Chromium window — the same stack that
 * successfully served the login window.
 */
async function loadNhentaiHtml(url: string, base: string, opts: { proxy?: string; cookieHeader?: string }): Promise<string> {
  const headers = { Referer: `${base}/`, Accept: 'text/html', ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {}) };
  let cookieHost = '';
  try {
    cookieHost = new URL(base).hostname;
  } catch {
    /* ignore */
  }
  const browserFetch = async (): Promise<string> =>
    await fetchHtmlViaBrowser(url, { proxy: opts.proxy, timeoutMs: 35_000, cookie: opts.cookieHeader, cookieHost });

  // Behind an active Tor proxy the undici TLS handshake is what CF rejects;
  // when the wall is known to be up, don't waste a doomed request.
  if (opts.proxy && cfWallActive(cookieHost)) {
    // Fast path: in-window fetch (browser TLS through the proxy + cookie
    // jar, no page-asset loading). Falls back to a full page load only when
    // a challenge/login wall needs real browsing.
    T('path: windowFetch-first (wall known)');
    try {
      const rr = await fetchViaWindowFetchRetry(url, { proxy: opts.proxy, timeoutMs: 35_000, cookie: opts.cookieHeader, cookieHost });
      T('windowFetch done (wall)');
      if (rr.status >= 400) {
        if (rr.status === 403 || rr.status === 503) markCfWall(cookieHost);
        return await browserFetch();
      }
      if (detectsAntiBot(0, rr.text)) return await browserFetch();
      return rr.text;
    } catch {
      return await browserFetch();
    }
  }
  if (opts.proxy) {
    // Same in-window fetch on FIRST use: it is both the fastest path and the
    // one that establishes CF clearance in the session.
    T('path: windowFetch-first (first use)');
    try {
      const rr = await fetchViaWindowFetchRetry(url, { proxy: opts.proxy, timeoutMs: 35_000, cookie: opts.cookieHeader, cookieHost });
      T('windowFetch done (first)');
      if (rr.status === 403 || rr.status === 503) {
        markCfWall(cookieHost);
        return await browserFetch();
      }
      if (detectsAntiBot(0, rr.text)) return await browserFetch();
      return rr.text;
    } catch {
      T('windowFetch failed (first)'); /* fall through to the direct attempt */
    }
  }
  try {
    const r = await httpFetch({ url, headers, allowHttpFallback: true }, opts.proxy);
    if (r.status === 403 || r.status === 503) {
      markCfWall(cookieHost);
      throw new Error(`HTTP ${r.status}`);
    }
    return r.text;
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (msg.startsWith('HTTP 5') && !msg.startsWith('HTTP 503')) throw e;
    // network errors / 403 / 503 → browser channel
    T('fallback: full page load channel');
    return await browserFetch();
  }
}

export async function searchNhentai(
  base: string,
  query: string,
  page: number,
  opts: { proxy?: string; cookieHeader?: string; showPageCounts?: boolean; tags?: string[] } = {},
): Promise<CatalogItem[]> {
  // Mirrors the original app: an empty query opens the homepage (trending
  // covers), a single tag with no query browses /tag/{slug}/, and a query
  // goes to /search/?q=.
  const tagPart = (opts.tags ?? []).map((t) => `tag:${t}`).join(' ');
  const nhentaiPageParam = page > 0 ? `page=${page + 1}` : '';
  let url: string;
  if (opts.tags?.length === 1 && query.trim() === '') {
    url = `${base}/tag/${encodeURIComponent(opts.tags[0].toLowerCase().replace(/\s+/g, '_'))}/`;
  } else if (query.trim() === '' && (opts.tags?.length ?? 0) === 0) {
    url = `${base}/`;
  } else {
    url = `${base}/search/?q=${encodeURIComponent([query.trim(), tagPart].filter(Boolean).join(' '))}`;
  }
  if (nhentaiPageParam) {
    url += (url.includes('?') ? '&' : '?') + nhentaiPageParam;
  }
  const text = await loadNhentaiHtml(url, base, opts);
  T(`page loaded url=${url} len=${text.length}`);
  let cookieHost = '';
  try {
    cookieHost = new URL(base).hostname;
  } catch {
    /* ignore */
  }
  // The onion mirror (and sometimes Cloudflare) redirects the search page to
  // /login when no valid session cookies are attached: the "layout-changed"
  // assertion below would otherwise blame the parser. Batch login-page
  // markers taken from the real login markup: tor-notice, the
  // username_or_email input, the "Login » nhentai" title, or the redirect's
  // reason=tor query marker.
  if (
    text.includes('tor-notice') ||
    text.includes('username_or_email') ||
    text.includes('Login » nhentai') ||
    text.includes('/login?reason=tor')
  ) {
    throw new Error(
      'NHentai требует авторизацию: сайт отдаёт каталог только залогиненным. ' +
        'Открой Настройки → «Войти в NHentai» (для onion — «Войти в NHentai (onion)») ' +
        'и войди в открывшемся окне. Куки соберутся автоматически.',
    );
  }
  const $ = cheerio.load(text);
  const results: CatalogItem[] = [];
  const seen = new Set<string>();
  $('a.cover').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    if (!href.includes('/g/')) return;
    const full = resolve(base, href);
    if (!full || seen.has(full)) return;
    seen.add(full);
    const title = $(el).attr('title') || $(el).find('img').first().attr('title') || '';
    const img = $(el).find('img').first();
    const cover = img.attr('data-src') || img.attr('src') || null;
    results.push({ url: full, title, coverUrl: cover ? resolve(base, cover) : null, pages: null });
  });
  if (results.length === 0) {
    // A valid nhentai search page without cover entries means the query
    // simply matched nothing (e.g. an empty query) — NOT a layout change.
    if (/<title>[^<]*nhentai/i.test(text)) {
      throw new Error('NHentai: ничего не найдено по этому запросу');
    }
    assertLayout(['class="cover"', '/g/'], text, 'NHentai');
  }

  // Page counts are enriched in the BACKGROUND (enrichNhentaiPageCounts):
  // blocking the catalog on 30 sequential Tor fetches made searches take a
  // minute, and bursty fan-out trips nhentai's 429 rate limiter.
  return results;
}

/**
 * Sequentially fetch page counts for catalog items and report progress.
 * Designed to run in the background after the search results are already
 * displayed; each item takes ~1.5 s through the in-window fetch channel.
 */
export async function enrichNhentaiPageCounts(
  items: CatalogItem[],
  base: string,
  opts: { proxy?: string; cookieHeader?: string },
  onEach: (url: string, pages: number) => void,
): Promise<void> {
  let cookieHost = '';
  try {
    cookieHost = new URL(base).hostname;
  } catch {
    /* ignore */
  }
  for (const item of items) {
    try {
      const rr = await fetchViaWindowFetchRetry(item.url, {
        proxy: opts.proxy,
        timeoutMs: 20_000,
        cookie: opts.cookieHeader,
        cookieHost,
      });
      const pages = rr.status < 400 ? parseNhentaiPageCount(rr.text) : null;
      if (pages != null) onEach(item.url, pages);
    } catch {
      /* skip this one */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}
