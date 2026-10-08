import * as cheerio from 'cheerio';
import { fetchHtmlSmart } from './fetch-html';
import { ehErrorFromResponse } from './catalog-search';
import { comxFetchText } from './comx-gate';
import { fetchViaWindowFetchRetry } from './browser-fetch';
import { detectsAntiBot } from './anti-bot';
import { logger } from './logger';

export interface SimpleGallery {
  title: string;
  pageUrls: string[];
  coverUrl: string | null;
  /** Per-page referer override, e.g. for nhentai CDN (index -> url) */
  sourcePages: (string | null)[];
}

const SKIP_KEYWORDS = ['logo', 'icon', 'avatar', 'sprite', 'banner', '/ads/', 'favicon', 'placeholder'];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** E-Hentai/ExHentai (clearnet and onion) gallery flow, ported from the old
 * Rust app: the gallery page is a paginated THUMBNAIL listing (?p=N, ≤20 per
 * page) — every variant links to its own `/s/{page_token}/{gid}-{page_num}`
 * viewer page, and the actual image URL lives in `img#img` on that page.
 * Related-galleries widgets also contain /s/ links for DIFFERENT galleries —
 * filter them by /{gid}/. */
async function fetchEhGallery(url: string, opts: { proxy?: string; cookieHeader?: string; timeoutMs?: number }): Promise<SimpleGallery> {
  const t0 = Date.now();
  const steps: string[] = [];
  const mark = (s: string): void => {
    steps.push(`${((Date.now() - t0) / 1000) | 0}s ${s}`);
  };
  const uid = new URL(url).pathname.match(/\/g\/(\d+)\//)?.[1];
  const belongsToGallery = (href: string): boolean => !uid || href.includes(`/${uid}-`) || href.includes(`/${uid}/`);
  const base = {
    proxy: opts.proxy,
    cookieHeader: opts.cookieHeader,
    timeoutMs: opts.timeoutMs ?? (opts.proxy ? 120_000 : 30_000),
  };
  const fetchPage = async (target: string): Promise<string> =>
    await fetchHtmlSmart(target, { ...base, timeoutMs: opts.timeoutMs ?? (opts.proxy ? 120_000 : 30_000) });
  const $init = cheerio.load(await fetchPage(url));
  mark('first listing page');
  const err = ehErrorFromResponse(200, $init.html());
  if (err) throw new Error(err);
  const title = $init('h1#gn').first().text().trim() || $init('title').first().text().trim() || 'E-Hentai Gallery';

  const pageUrls: string[] = [];
  const seen = new Set<string>();
  const collect = (html: string): void => {
    const $ = cheerio.load(html);
    $('a[href*="/s/"]').each((_i, el) => {
      const href = $(el).attr('href') ?? '';
      if (!belongsToGallery(href)) return;
      const full = resolveRelative(url, href);
      if (!full || seen.has(full)) return;
      seen.add(full);
      pageUrls.push(full);
    });
  };
  collect($init.html());

  // Listing page count from the summary ("Showing 1 - 20 of 151 images"),
  // then concurrent fetch of the remaining pages (4 per batch) — sequential
  // crawling through Tor was minutes for big galleries.
  const sm = $init.html().match(/Showing\s+\d+\s*-\s*\d+\s+of\s+(\d+)/i);
  const listingTotal = sm ? Math.max(1, Math.ceil(Number(sm[1]) / 20)) : 1;
  const listingUrls: string[] = [];
  for (let p = 1; p < listingTotal && p <= 60; p++) {
    listingUrls.push(`${url}${url.includes('?') ? '&' : '?'}p=${p}`);
  }
  const CONC = 4;
  for (let i = 0; i < listingUrls.length; i += CONC) {
    await Promise.all(
      listingUrls.slice(i, i + CONC).map(async (u) => {
        try {
          collect(await fetchPage(u));
        } catch (e) {
          logger.warn('[eh-gallery] listing page fetch failed', u, e);
        }
      }),
    );
    mark(`listing batch ${i / CONC + 1}/${Math.ceil(listingUrls.length / CONC)} (total ${pageUrls.length})`);
  }
  if (pageUrls.length === 0) {
    throw new Error(
      'На странице галереи не найдено ни одной ссылки /s/ — вероятно, ExHentai отдал страницу без активной сессии (проверь куки) или галерея недоступна.',
    );
  }

  // The /s/ viewer pages ARE the page list. Resolving them all up front is
  // minutes of sequential Tor requests before the reader opens — instead the
  // loader resolves each viewer page lazily (and caches the resolved image
  // URL in place). So pageUrls here are /s/ links; real images are fetched
  // on demand in online-gallery.loadOne.
  mark('done');
  logger.info('[eh-gallery-timing]', steps.join(' | '));
  return { title, pageUrls, coverUrl: null, sourcePages: pageUrls.map(() => null) };
}

function resolveRelative(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function resolve(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractNhentaiCover(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html);
  for (const sel of ['#cover img', 'img[alt="Cover"]', '.gallery-cover img', 'img.lazyload']) {
    const el = $(sel).first();
    const src = el.attr('data-src') || el.attr('data-lazy-src') || el.attr('src');
    if (src) return resolve(pageUrl, src);
  }
  return null;
}

/** Extracts a balanced {...} JSON object starting right after a marker. */
export function extractBalancedObject(html: string, marker: string): string | null {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let i = html.indexOf('{', start);
  if (i < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  const begin = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return html.slice(begin, i + 1);
    }
  }
  return null;
}

/** nhentai-style embedded JSON reader blob. Ported from the original Rust
 * app (online.rs try_nhentai_reader_pages): always serves full-resolution
 * pages from the official i.nhentai.net CDN — never the mirror/t* hosts the
 * page markup or mirror CDNs advertise (those serve low-res thumbnails). */
export function tryNhentaiReaderPages(html: string): string[] | null {
  // nhentai.net wraps its gallery JSON in JSON.parse("…"), escaping inner
  // quotes: normalise \" → " so both old and new blobs parse the same way.
  const normalized = html.replace(/\\"/g, '"').replace(/(:) /g, '$1').replace(/ :/g, ':');

  const mediaIdM = normalized.match(/"media_id":"?\s*"([^"]+)"/) ?? normalized.match(/"media_id":\s*"?([^",]+)"?/);
  if (!mediaIdM) return null;
  const mediaId = mediaIdM[1];

  // Slice out the "pages":[ … ] array contents (bracket-depth aware).
  const keyIdx = normalized.indexOf('"pages"');
  if (keyIdx === -1) return null;
  const openBr = normalized.indexOf('[', normalized.indexOf(':', keyIdx));
  if (openBr === -1) return null;
  let depth = 1;
  let closePos = -1;
  for (let i = openBr + 1; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        closePos = i;
        break;
      }
    }
  }
  if (closePos === -1) return null;
  const pagesBlob = normalized.slice(openBr + 1, closePos);

  // New format (2024+): each entry carries "path":"galleries/{media_id}/n.webp"
  const paths = [...pagesBlob.matchAll(/"path":\s*"([^"]+)"/g)].map((m) => m[1]);
  if (paths.length > 0) {
    return paths.map((p) => `https://i.nhentai.net/${p}`);
  }

  // Old format: "t" type codes → derive extension, build from media_id.
  const typeCodes = [...pagesBlob.matchAll(/"t":\s*"([A-Za-z])"/g)].map((m) => m[1]);
  if (typeCodes.length === 0) return null;
  const extFor = (t: string): string => (t === 'p' ? 'png' : t === 'g' ? 'gif' : 'webp');
  return typeCodes.map((t, i) => `https://i.nhentai.net/galleries/${mediaId}/${i + 1}.${extFor(t)}`);
}

/** manga-shi reader container pages. */
function tryMangashiReaderPages(html: string, pageUrl: string): string[] | null {
  const $ = cheerio.load(html);
  const items = $('.reader-pages .reader-page').toArray();
  if (items.length === 0) return null;
  const pageNum = (u: string): number => {
    const fn = u.split('/').pop() ?? '';
    const digits = fn.match(/^\d+/);
    return digits ? Number(digits[0]) : 0;
  };
  const rows: { order: number | null; url: string }[] = [];
  for (const el of items) {
    const $el = $(el);
    const orderStr = $el.attr('data-page-order');
    const img = $el.find('img.reader-image').first();
    const raw = img.attr('data-src') || img.attr('src') || '';
    if (!raw || raw.startsWith('data:')) continue;
    const resolved = resolve(pageUrl, raw);
    if (!resolved) continue;
    rows.push({ order: orderStr ? Number(orderStr) : null, url: resolved });
  }
  rows.sort((a, b) => {
    if (a.order != null && b.order != null) return a.order - b.order;
    if (a.order != null) return -1;
    if (b.order != null) return 1;
    return pageNum(a.url) - pageNum(b.url);
  });
  return rows.map((r) => r.url);
}

export async function fetchSimpleGallery(
  url: string,
  opts: { proxy?: string; cookieHeader?: string; timeoutMs?: number } = {},
): Promise<SimpleGallery> {
  // E-Hentai / ExHentai (clearnet + onion) uses its dedicated listing-page
  // flow — direct-heuristics on a gallery page only see the cover thumbnails.
  if (url.includes('exhentai') || url.includes('e-hentai.org')) {
    return await fetchEhGallery(url, opts);
  }
  let html;
  if (url.includes('com-x.life')) {
    html = await comxFetchText(url, { proxy: opts.proxy, timeoutMs: opts.timeoutMs });
  } else if (url.includes('nhentai')) {
    // nhentai is Cloudflare-gated: prefer the fast in-window fetch (browser
    // TLS through the proxy + session cookie jar), fall back to the slow
    // smart fetch only when that channel is unavailable.
    let cookieHost = '';
    try {
      cookieHost = new URL(url).hostname;
    } catch {
      /* ignore */
    }
    const t = Date.now();
    try {
      const rr = await fetchViaWindowFetchRetry(url, { proxy: opts.proxy, timeoutMs: 35_000, cookie: opts.cookieHeader, cookieHost });
      logger.info('[gallery-timing] window-fetch', rr.status, 'len', rr.text.length, Date.now() - t, 'ms');
      if (rr.status < 400 && !detectsAntiBot(0, rr.text)) {
        html = rr.text;
      } else {
        throw new Error(`window-fetch ${rr.status}`);
      }
    } catch {
      logger.info('[gallery-timing] window-fetch FAILED after', Date.now() - t, 'ms — slow path');
      html = await fetchHtmlSmart(url, {
        proxy: opts.proxy,
        cookieHeader: opts.cookieHeader,
        timeoutMs: opts.timeoutMs ?? (opts.proxy ? 120_000 : 30_000),
      });
    }
  } else {
    html = await fetchHtmlSmart(url, {
      proxy: opts.proxy,
      cookieHeader: opts.cookieHeader,
      timeoutMs: opts.timeoutMs ?? (opts.proxy ? 120_000 : 30_000),
    });
  }

  if (url.includes('exhentai') || url.includes('e-hentai.org')) {
    const ehErr = ehErrorFromResponse(200, html);
    if (ehErr) throw new Error(ehErr);
  }
  const $ = cheerio.load(html);

  const title = $('title').first().text().trim() || 'Gallery';

  let pageUrls: string[] = [];
  let coverUrl: string | null = url.includes('nhentai') ? extractNhentaiCover(html, url) : null;

  // A0: nhentai embedded JSON reader
  if (pageUrls.length === 0) {
    const p = tryNhentaiReaderPages(html);
    if (p && p.length > 0) pageUrls = p;
  }

  // A1: manga-shi reader container
  if (pageUrls.length === 0 && url.includes('manga-shi')) {
    const p = tryMangashiReaderPages(html, url);
    if (p && p.length > 0) pageUrls = p;
  }

  // A2: direct content <img> scraping
  if (pageUrls.length === 0) {
    const seen = new Set<string>();
    $('img').each((_i, el) => {
      const $el = $(el);
      const src = ($el.attr('data-src') || $el.attr('data-original') || $el.attr('data-lazy-src') || $el.attr('src') || '').trim();
      if (!src || src.startsWith('data:')) return;
      const lower = src.toLowerCase();
      if (SKIP_KEYWORDS.some((k) => lower.includes(k))) return;
      const full = resolve(url, src);
      if (!full || seen.has(full)) return;
      seen.add(full);
      pageUrls.push(full);
    });
  }

  if (pageUrls.length === 0) {
    throw new Error(
      'Не удалось найти изображения страниц на этой странице. Возможно, это страница ' +
        'описания тайтла, а не сама глава, либо сайт изменил вёрстку и эвристика парсера ' +
        'больше не подходит.',
    );
  }

  // nhentai cover synthesis fallback from first page URL
  if (!coverUrl && url.includes('nhentai')) {
    const first = pageUrls[0];
    if (first.includes('nhentai.net')) {
      const lastSlash = first.lastIndexOf('/');
      if (lastSlash >= 0) {
        const base = first.slice(0, lastSlash + 1);
        coverUrl = base.replace('://i.', '://t.') + 'thumb.webp';
      }
    }
  }

  const sourcePages: (string | null)[] = pageUrls.map(() => null);
  // nhentai reader page URLs for renewing stale signed URLs
  if (url.includes('nhentai')) {
    const parsed = new URL(url);
    const segs = parsed.pathname.split('/').filter(Boolean);
    if (segs[0] === 'g' && segs[1]) {
      const gid = segs[1];
      const base = url.includes('.onion') ? (url.split('/g/')[0] ?? '') : 'https://nhentai.net';
      pageUrls.forEach((_, i) => {
        if (pageUrls[i].includes('nhentai')) {
          sourcePages[i] = `${base}/g/${gid}/${i + 1}/`;
        }
      });
    }
  }

  return { title, pageUrls, coverUrl, sourcePages };
}
