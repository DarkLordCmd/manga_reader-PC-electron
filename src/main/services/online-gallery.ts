import { randomUUID } from 'crypto';
import { fetch as undiciFetch } from 'undici';
import { buildProxyDispatcher } from './http';
import { shouldUseDirectEhImage, withoutCookieHeader } from './eh-image-policy';
import { withMirror } from './lib-mirror';
import { fetchHtmlSmart } from './fetch-html';
import { userAgentForUrl } from './user-agent';
import { logger } from './logger';
import { readPageCache, writePageCache } from './page-cache';
import { isImageBuffer } from '../app/mime';
import { handleLimitFailure } from './eh-limits-hook';
import { isSafeRemoteUrl } from './url-guard';

/** Read the original (full-size) image instead of the 1280 px resized copy.
 * Configurable in Settings; the viewer page exposes the original as an anchor
 * whose text is "WIDTH x HEIGHT". */
let ehOriginalImages = false;
export function setEhOriginalImages(enabled: boolean): void {
  ehOriginalImages = enabled;
}

export const MAX_CONCURRENT = 10;
export const LOAD_AHEAD = 40;
/**
 * E-Hentai meters *viewed images* per account/IP, not requests per second, so
 * warming 40 pages ahead burned the quota of a reader who looks at five. EH
 * galleries get a short window; the reader extends it as the position moves.
 */
export const EH_LOAD_AHEAD = 10;
/** Tor-proxied galleries: a circuit carries a handful of streams comfortably,
 * and queuing 40 images through it made the pages the user actually reads wait
 * behind prefetched ones (and slowed every other request on that circuit). */
export const TOR_LOAD_AHEAD = 6;
export const KEEP_BEHIND = 4;

/** Read-ahead window for a page URL: EH is quota-metered, Tor is bandwidth- and
 * latency-limited, everything else can take the wide window. */
export function loadAheadFor(url: string, viaTor = false): number {
  if (EH_HOST.test(url)) return EH_LOAD_AHEAD;
  return viaTor ? TOR_LOAD_AHEAD : LOAD_AHEAD;
}

/** Global pacing for E-Hentai hosts: keeps the burst under the ban
 * threshold while letting the 10-wide queue stay busy on other hosts.
 * E-Hentai meters *viewed images*, so the gate only spaces the /s/ viewer
 * requests; gating the image fetch as well doubled the per-page latency
 * (measured ~2 s/page) without protecting the quota. */
const EH_HOST = /exhentai|e-hentai\.org/;
const EH_GATE_MS = 400;
/** Onion/clearnet EH tolerate far fewer parallel connections than ordinary
 * CDNs: with 10 in flight the Tor circuit reset roughly a third of the
 * page requests (`[eh-page] viewer failed: fetch failed`). */
const EH_MAX_CONCURRENT = 4;
let ehActive = 0;
const ehWaiters: (() => void)[] = [];
async function ehSlot(): Promise<void> {
  if (ehActive < EH_MAX_CONCURRENT) {
    ehActive++;
    return;
  }
  await new Promise<void>((r) => ehWaiters.push(r));
}
function ehRelease(): void {
  // Transfer the slot instead of decrement-then-wake: the old order let a
  // racing ehSlot() take the freed slot and then have the woken waiter
  // increment too, exceeding EH_MAX_CONCURRENT (the exact thing the gate is
  // there to prevent) and burning the EH quota faster than intended.
  const next = ehWaiters.shift();
  if (next) next();
  else ehActive--;
}
let ehNextAt = 0;
function ehGate(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, ehNextAt);
  ehNextAt = start + EH_GATE_MS;
  return new Promise((r) => setTimeout(r, Math.max(0, start - now)));
}

interface Entry {
  index: number;
  url: string;
  /** the /s/ viewer page the image URL was resolved from (EH galleries) */
  viewerUrl: string | null;
  buffer: Buffer | null;
  state: 'idle' | 'loading' | 'done' | 'failed';
  error: string | null;
  promise: Promise<void> | null;
  failedAt: number | null;
}

interface OnlineGallery {
  title: string;
  entries: Entry[];
  position: number;
  proxy?: string;
  /** EH CDN images may go direct while the gallery pages still use Tor. */
  directImages: boolean;
}

const galleries = new Map<string, OnlineGallery>();
let inFlight = 0;

/** Pending page loads, ordered by relevance to the CURRENT reading position.
 *
 * A plain FIFO was wrong in both directions: the reader used to enqueue every
 * page of the chapter at once (all <img> tags), and the "requested page first"
 * tweak unshifted EACH of those requests — so the queue ended up reversed and a
 * 123-page chapter loaded 1..10, then 122..18, then the middle. Ordering by
 * distance from the live position (and re-evaluating it on every pump, so a
 * jump re-targets the queue) gives the "load what I am looking at, then
 * outwards" behaviour.
 */
interface QueuedTask {
  g: OnlineGallery;
  index: number;
  seq: number;
  /** The page the renderer is explicitly waiting for (a jump/scroll target). */
  urgent: boolean;
  run: () => void;
}
const queue: QueuedTask[] = [];
let taskSeq = 0;

function queueDistance(t: QueuedTask): number {
  if (t.urgent) return -1;
  return Math.abs(t.index - t.g.position);
}

function pump(): void {
  while (inFlight < MAX_CONCURRENT && queue.length > 0) {
    let best = 0;
    let bestDistance = queueDistance(queue[0]);
    let bestSeq = queue[0].seq;
    for (let i = 1; i < queue.length; i++) {
      const d = queueDistance(queue[i]);
      if (d < bestDistance || (d === bestDistance && queue[i].seq < bestSeq)) {
        best = i;
        bestDistance = d;
        bestSeq = queue[i].seq;
      }
    }
    const task = queue.splice(best, 1)[0];
    inFlight++;
    task.run();
  }
}

function enqueue(t: Omit<QueuedTask, 'seq'>): void {
  queue.push({ ...t, seq: taskSeq++ });
  pump();
}

/** Current warm window — recomputed from the live position so a queued
 * prefetch that is no longer relevant can be dropped instead of downloaded. */
function inWarmWindow(g: OnlineGallery, index: number): boolean {
  const ahead = loadAheadFor(g.entries[g.position]?.url ?? g.entries[0]?.url ?? '', !!g.proxy);
  return index >= Math.max(0, g.position - KEEP_BEHIND) && index <= g.position + ahead;
}

/** Galleries kept in memory at once. Each holds the decoded bytes of every
 * warmed page (~0.5 MB × up to 20 pages), and nothing ever removed them: a long
 * session that opened many chapters grew without bound. */
const MAX_GALLERIES = 4;

export function createOnlineGallery(title: string, urls: string[], proxy?: string, directImages = false): string {
  const gid = randomUUID();
  while (galleries.size >= MAX_GALLERIES) {
    const oldest = galleries.keys().next().value;
    if (oldest === undefined) break;
    galleries.delete(oldest);
  }
  galleries.set(gid, {
    title,
    entries: urls.map((url, index) => ({
      index,
      url,
      buffer: null,
      state: 'idle',
      error: null,
      promise: null,
      failedAt: null,
      viewerUrl: (url.includes('exhentai') || url.includes('e-hentai.org')) && /\/s\//.test(url) ? url : null,
    })),
    position: 0,
    proxy,
    directImages,
  });
  return gid;
}

export function setReadingPosition(gid: string, index: number): void {
  const g = galleries.get(gid);
  if (!g) return;
  // Keep the gallery being read at the MRU end of the eviction order.
  galleries.delete(gid);
  galleries.set(gid, g);
  g.position = index;
  for (const e of g.entries) {
    if (e.state === 'done' && e.index < index - KEEP_BEHIND) {
      e.buffer = null;
      e.state = 'idle';
      // The promise must go with the buffer: it already resolved, so the next
      // requestPage() would `settle()` it, find state !== 'done' and reject —
      // and because the state stayed 'idle' (not 'failed') the recovery branch
      // never ran. Scrolling back more than KEEP_BEHIND pages made those pages
      // permanently broken ("стр. N / ↻ повторить").
      e.promise = null;
    }
  }
}

/** Plain HTTP fetch of an EH viewer page through the gallery dispatcher.
 * Returns null when the fast path fails (caller falls back to fetchHtmlSmart).
 * The reason is logged: "no images in the reader" was previously invisible. */
async function fetchViewerHtml(url: string, proxy: string | undefined, cookie: string | undefined): Promise<string | null> {
  try {
    const controller = new AbortController();
    // Through Tor the viewer page (SOCKS + exit + TLS) often needs more than
    // 30 s right after a circuit change; the caller still has fetchHtmlSmart as
    // a fallback, so a too-short budget just doubled the latency.
    const timer = setTimeout(() => controller.abort(), proxy ? 45_000 : 30_000);
    try {
      const dispatch = proxy ? { dispatcher: buildProxyDispatcher(proxy) } : {};
      const res = await undiciFetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'text/html,application/xhtml+xml',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        signal: controller.signal,
        ...dispatch,
      } as any);
      if (!res.ok) {
        void res.body?.cancel().catch(() => {});
        logger.warn('[eh-page] viewer HTTP', res.status, 'proxy=', !!proxy, 'cookie=', !!cookie, url);
        return null;
      }
      const text = await res.text();
      if (/Cloudflare|Just a moment|checking your browser/i.test(text.slice(0, 600))) {
        logger.warn('[eh-page] viewer anti-bot wall, len', text.length, url);
        return null;
      }
      logger.info('[eh-page] viewer ok, len', text.length, 'img=', /id="img"/.test(text), url);
      return text;
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    logger.warn(
      '[eh-page] viewer failed:',
      e?.message ?? e,
      'cause=',
      String(e?.cause?.message ?? e?.cause ?? '').slice(0, 120),
      'proxy=',
      !!proxy,
      'cookie=',
      !!cookie,
      url,
    );
    return null;
  }
}

/** Downloads one page image with retries: mirror/webcore transient glitches,
 * 429/5xx and connection resets all deserve another attempt with backoff.
 * Text-HTML responses (rate-limit walls, plastic pages) end the loop early. */
async function fetchImageWithRetry(g: OnlineGallery, fetchUrl: string, headers: Record<string, string>, proxy = g.proxy): Promise<Buffer> {
  const ATTEMPTS = 3;
  // Budget for the WHOLE transfer (SOCKS handshake + exit connect + TLS + the
  // image). 30 s cut off healthy Tor pages and each abort started two more
  // full attempts (up to ~90 s per page).
  const timeoutMs = proxy ? 90_000 : 30_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const dispatch = proxy ? { dispatcher: buildProxyDispatcher(proxy) } : {};
        // MangaDex page images (uploads.mangadex.org) are behind the same edge
        // bot check as its API: a browser UA without the challenge cookie is
        // 403'd, so the host decides the UA. Callers never set one.
        // undiciFetch (not the global fetch) keeps the dispatcher instance and
        // the connection pool in one undici copy.
        const res = await undiciFetch(fetchUrl, {
          headers: { 'User-Agent': userAgentForUrl(fetchUrl), ...headers },
          signal: controller.signal,
          ...dispatch,
        } as any);
        if (!res.ok) {
          void res.body?.cancel().catch(() => {});
          throw new Error(`HTTP ${res.status} for ${fetchUrl}`);
        }
        // Any non-image body (E-Hentai limit wall, login page, CF challenge)
        // must never be stored as a page. This used to be checked only for the
        // EH site hosts, so a limit page from a H@H mirror (hath.network) was
        // written to the page cache as "the image" — permanently broken page.
        const ct = res.headers.get('content-type') ?? '';
        if (ct && !ct.startsWith('image/') && !ct.includes('application/octet-stream')) {
          const bad = Buffer.from(await res.arrayBuffer());
          const head = bad.subarray(0, 600).toString('utf-8');
          if (/exceeded your image viewing limits|exceeded your usage limit/i.test(head)) {
            throw new LimitError('Превышен лимит просмотра изображений на E-Hentai.');
          }
          throw new Error(`сервер вернул ${ct} вместо изображения (${fetchUrl})`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (!isImageBuffer(buf)) {
          const head = buf.subarray(0, 400).toString('utf-8');
          if (/exceeded your image viewing limits|exceeded your usage limit/i.test(head)) {
            throw new LimitError('Превышен лимит просмотра изображений на E-Hentai.');
          }
          throw new Error(`тело ответа не похоже на изображение (${fetchUrl})`);
        }
        if (EH_HOST.test(fetchUrl)) {
          let host = '';
          try {
            host = new URL(fetchUrl).host;
          } catch {
            /* keep empty */
          }
          logger.debug('[eh-image] ok bytes=', buf.length, 'ct=', ct, 'host=', host);
        }
        return buf;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      if (err instanceof LimitError) throw err; // rate-limit walls don't benefit from retrying
      // An abort means "this path is too slow right now"; retrying just repeats
      // the wait. The renderer's own auto-retry gives the page a fresh attempt.
      if ((err as any)?.name === 'AbortError') {
        throw new Error(`Страница не загрузилась за ${Math.round(timeoutMs / 1000)} с (${g.proxy ? 'Tor/сеть' : 'сеть'}).`);
      }
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

class LimitError extends Error {}

/** Why an EH /s/ page did not yield an image — needed because the reader
 * showed blank pages with no reason at all. */
export function describeEhViewerFailure(html: string): string {
  const t = (html ?? '').slice(0, 4000);
  const lower = t.toLowerCase();
  if (t.trim() === '') return 'ExHentai вернул пустую страницу (нет активной сессии или Tor-выход заблокирован)';
  if (t.startsWith('You have exceeded your image')) return 'превышен лимит просмотра изображений E-Hentai';
  if (lower.includes('exceeded your usage limit')) return 'превышен лимит запросов E-Hentai';
  if (lower.includes('509.gif')) return 'превышен лимит просмотра изображений E-Hentai (509.gif)';
  if (lower.includes('temporarily banned') || lower.includes('excessive request rate')) return 'временный бан по IP/частоте запросов';
  // E-Hentai's "Multi-Page Viewer" style serves images through a different page
  // (JS/JSON), so /s/ parsing finds nothing. JHenTai explicitly refuses MPV for
  // the same reason and tells the user to switch the site style.
  if (lower.includes('multi-page viewer') || lower.includes('mpv') || /id="img"[^>]*data-src/.test(t))
    return 'включён Multi-Page Viewer. В настройках ExHentai (Front Page → Multi-Page Viewer) поставь «Default» и открой главу снова';
  if (lower.includes('poni') || lower.includes('sad panda') || lower.includes('not logged in'))
    return 'нет активной сессии ExHentai (poni=no) — обнови cookie аккаунта';
  if (lower.includes('this gallery is unavailable') || lower.includes('404 not found')) return 'галерея недоступна';
  return `страница ${t.length} байт без img#img — требуется авторизация или ExHentai изменил вёрстку`;
}

async function loadOne(g: OnlineGallery, e: Entry, headers: Record<string, string>): Promise<void> {
  let ehHeld = false;
  try {
    // Page URLs come from source HTML: refuse loopback/LAN targets so a hostile
    // source cannot use the main process to probe local services via SSRF.
    // (Skipped in tests, which serve pages from a local HTTP server.)
    if (!process.env.VITEST && !isSafeRemoteUrl(e.url)) throw new Error('Страница указывает на недопустимый (локальный) адрес');
    // Served from disk: re-reads of a chapter must not hit the network (or the
    // E-Hentai image quota) again. `finally` still releases the queue slot.
    if (cachedPage(e)) return;
    // E-Hentai/ExHentai pageUrls are /s/ viewer pages, not images: fetch
    // the viewer HTML, extract img#img, then download the image. The
    // resolved URL is written back so eviction/re-requests skip the extra
    // page (until the signed CDN URL expires).
    const isEh = EH_HOST.test(e.url);
    const isEhViewer = isEh && /\/s\/[0-9a-z]+\/\d+-\d+/.test(e.url);
    if (isEh) {
      await ehSlot();
      ehHeld = true;
      await ehGate();
    }
    let fetchUrl = withMirror(e.url);
    if (isEhViewer) {
      // Fast path first: plain HTTP fetch via the gallery dispatcher. The
      // browser fallback (fetchHtmlSmart) only for a real anti-bot wall,
      // and up to 2 attempts when the fast one cannot resolve the image.
      let img: string | null = null;
      let originalImg: string | null = null;
      for (let va = 0; va < 2 && !img; va++) {
        const vh = await fetchViewerHtml(e.url, g.proxy, headers.Cookie);
        const viewerHtml =
          vh !== null ? vh : await fetchHtmlSmart(e.url, { timeoutMs: 45_000, proxy: g.proxy, cookieHeader: headers.Cookie });
        if (/exceeded your image viewing limits|sad panda/i.test(viewerHtml)) {
          throw new LimitError('Превышен лимит просмотра изображений на E-Hentai.');
        }
        const m = viewerHtml.match(/img id="img"[^>]*\ssrc="([^"]+)"/) ?? viewerHtml.match(/id="img"[^>]*src="([^"]+)"/);
        if (!m) {
          if (va < 1) {
            await new Promise((r) => setTimeout(r, 1200));
            continue;
          }
          throw new Error(`Не удалось получить изображение со страницы EH (/s/): ${describeEhViewerFailure(viewerHtml)}`);
        }
        img = new URL(m[1], e.url).toString();
        // The original-size link is an anchor labelled "WIDTH x HEIGHT"; using
        // it is opt-in (Settings), because originals can be several MB each.
        if (ehOriginalImages) {
          const om = viewerHtml.match(/<a[^>]+href="([^"]+)"[^>]*>\s*\d+\s*x\s*\d+\s*<\/a>/);
          if (om) originalImg = new URL(om[1], e.url).toString();
        }
      }
      if (!img) throw new Error('Не удалось распознать страницу изображения EH (/s/), сайт мог изменить вёрстку.');
      if (originalImg && !/\/509\.gif(?:\?|$)/i.test(originalImg)) img = originalImg;
      // E-Hentai returns a 509.gif placeholder instead of the picture once the
      // image-view limit is hit. JHenTai checks exactly these URLs; without the
      // check the placeholder was cached and shown as a page.
      if (/\/509\.gif(?:\?|$)/i.test(img)) {
        throw new LimitError('Превышен лимит просмотра изображений на E-Hentai (сайт вернул 509.gif).');
      }
      e.url = img;
      fetchUrl = img;
    }
    // Optional speed-up: EH CDN (ehgt/hath) images bypass Tor while the /s/
    // viewer page and the listing stay proxied. Domain-scoped cookies must not
    // leak to the CDN, so a direct request drops them.
    const directImage = shouldUseDirectEhImage(g.directImages, g.proxy, fetchUrl);
    const imageProxy = directImage ? undefined : g.proxy;
    const imageHeaders = directImage ? withoutCookieHeader(headers) : headers;
    e.buffer = await fetchImageWithRetry(g, fetchUrl, imageHeaders, imageProxy);
    e.state = 'done';
    if (e.buffer) writePageCache(cacheKeyFor(e), e.buffer);
  } catch (err: any) {
    if (err instanceof LimitError) {
      // Route the reader's limit through the same state machine as the catalog:
      // switch to the next account once (or park the source). Previously this
      // stayed a local error, so the rest of the prefetch window kept hitting
      // the wall and the UI never showed a limit state.
      e.error = handleLimitFailure('image-limit', null, e.url).message;
      logger.warn('[eh-page] limit wall —', e.error);
    } else {
      e.error = err?.message ?? String(err);
    }
    e.state = 'failed';
    e.failedAt = Date.now();
    if (EH_HOST.test(e.url) || e.url.includes('hath.network') || e.url.includes('ehgt.org')) {
      logger.warn('[eh-page] failed', e.url.slice(0, 120), '—', e.error);
    }
  } finally {
    if (ehHeld) ehRelease();
    inFlight--;
    pump();
  }
}

function settle(entry: Entry): Promise<Buffer | null> {
  return entry.promise!.then(() => {
    if (entry.state === 'done') return entry.buffer;
    throw new Error(entry.error ?? 'failed');
  });
}

/** Stable identity of a page: the `/s/` viewer URL for EH (the resolved CDN URL
 * carries a short-lived token), the page URL otherwise. */
function cacheKeyFor(entry: Entry): string {
  return entry.viewerUrl ?? entry.url;
}

/** Serves the page from disk cache when present — no network, no quota. */
function cachedPage(entry: Entry): Buffer | null {
  const buf = readPageCache(cacheKeyFor(entry));
  if (!buf) return null;
  entry.buffer = buf;
  entry.state = 'done';
  return buf;
}

export function requestPage(
  gid: string,
  index: number,
  headers: Record<string, string>,
  opts: { thumb?: boolean } = {},
): Promise<Buffer | null> {
  const g = galleries.get(gid);
  if (!g) throw new Error('Gallery not found');
  galleries.delete(gid);
  galleries.set(gid, g);
  const e = g.entries[index];
  if (!e) throw new Error(`Page ${index} out of range`);
  if (e.state === 'done') return Promise.resolve(e.buffer);
  if (e.state === 'failed') {
    // Transient failures (network hiccup, rate limit) used to be permanent —
    // the renderer's retry re-request now gets a fresh load with backoff.
    const since = e.failedAt ? Date.now() - e.failedAt : Infinity;
    if (since < 3000) return Promise.reject(new Error(e.error ?? 'failed'));
    // Re-resolve EH entries from their /s/ viewer page (the signed image URL
    // may have expired after eviction).
    if (e.viewerUrl && e.url !== e.viewerUrl) e.url = e.viewerUrl;
    e.state = 'idle';
    e.promise = null;
  }
  if (e.promise) return settle(e);

  if (cachedPage(e)) return Promise.resolve(e.buffer);

  const ahead = loadAheadFor(g.entries[g.position]?.url ?? g.entries[0]?.url ?? '', !!g.proxy);
  const start = Math.max(0, g.position - KEEP_BEHIND);
  const end = Math.min(g.entries.length, g.position + ahead + 1);
  const toWarm = g.entries.slice(start, end).filter((x) => x.state === 'idle' && x.promise === null);

  e.promise = new Promise<void>((resolvePromise) => {
    enqueue({
      g,
      index: e.index,
      // Thumbnails are background decoration: they must never outrank the page
      // the reader is waiting for (the thumbnail panel used to fetch FULL pages
      // with urgent priority, burning E-Hentai quota and Tor traffic).
      urgent: !opts.thumb,
      run: () => {
        void loadOne(g, e, headers).then(resolvePromise);
      },
    });
  });
  for (const w of toWarm) {
    if (w === e || w.promise) continue;
    w.promise = new Promise<void>((rp) => {
      enqueue({
        g,
        index: w.index,
        urgent: false,
        run: () => {
          // The user may have jumped away while this sat in the queue: drop the
          // stale prefetch instead of spending Tor bandwidth on a page that is
          // no longer in the window (and clear the promise so a later request
          // gets a fresh load rather than a settled-but-empty entry).
          if (!inWarmWindow(g, w.index)) {
            w.promise = null;
            rp();
            return;
          }
          void loadOne(g, w, headers).then(rp);
        },
      });
    });
  }
  return settle(e);
}

export function getGalleryPages(gid: string): { title: string; pageCount: number } | null {
  const g = galleries.get(gid);
  return g ? { title: g.title, pageCount: g.entries.length } : null;
}

export function pageReady(gid: string, index: number): boolean {
  const g = galleries.get(gid);
  return !!g && g.entries[index]?.state === 'done';
}
