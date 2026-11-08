import type { Settings } from '@shared/settings';
import { httpFetchBinary } from './http';
import { withMirror } from './lib-mirror';
import { logger } from './logger';

/** Effective Tor SOCKS address (the bundled daemon when it is running).
 * Injected from main so covers never target a stale user address while the
 * embedded daemon listens on its own port. */
let torSocksResolver: (() => string | null) | null = null;

export function setCoverTorResolver(fn: (() => string | null) | null): void {
  torSocksResolver = fn;
}

function torSocks(s: Settings): string {
  return torSocksResolver?.() || s.tor_socks_addr || '127.0.0.1:9150';
}

function siteKeyForUrl(url: string): string | null {
  const l = url.toLowerCase();
  if (l.includes('mangadex') || l.includes('uploads.mangadex.org')) return 'mangadex';
  if (l.includes('ehgt.org')) return 'ehgt';
  if (l.includes('exhentai')) return 'exhentai';
  if (l.includes('e-hentai.org')) return 'ehentai';
  if (l.includes('nhentai')) return 'nhentai';
  if (l.includes('senkuro')) return 'senkuro';
  if (l.includes('remanga')) return 'remanga';
  if (l.includes('manga-shi')) return 'mangashi';
  if (l.includes('mangalib') || l.includes('cdnlibs.org') || l.includes('imglib.info') || l.includes('imgslib.link')) return 'mangalib';
  if (l.includes('com-x.life')) return 'comx';
  // Grouple cover CDNs live on separate hosts (e.g. mmm/resrmr.one-way.work).
  if (l.includes('one-way.work') || l.includes('readmanga') || l.includes('mintmanga') || l.includes('mangapoisk')) return 'grouple';
  return null;
}

export function coverReferer(siteKey: string | null, url: string): string | undefined {
  switch (siteKey) {
    case 'mangadex':
      return 'https://mangadex.org/';
    case 'ehgt':
      return url.toLowerCase().includes('e-hentai') ? 'https://e-hentai.org/' : 'https://exhentai.org/';
    case 'exhentai':
      return 'https://exhentai.org/';
    case 'ehentai':
      return 'https://e-hentai.org/';
    case 'senkuro':
      return 'https://senkuro.me/';
    case 'remanga':
      return 'https://remanga.org/';
    case 'mangashi':
      return 'https://manga-shi.org/';
    case 'mangalib':
      return 'https://mangalib.me/';
    case 'comx':
      return 'https://com-x.life/';
    case 'grouple':
      // one-way.work CDN hot-link check passes with the grouple-site Referer
      // (verified live: 402 without, 200 with).
      return 'https://mintmanga.com/';
    case 'nhentai':
      return url.includes('.onion') ? url : 'https://nhentai.net/';
    default:
      return undefined;
  }
}

function coverProxy(siteKey: string | null, url: string, s: Settings): string | undefined {
  const tor = torSocks(s);
  const site = siteKey === 'ehgt' ? 'ehentai' : siteKey;
  if (url.includes('.onion')) return tor;
  // Grouple CDN hosts (one-way.work etc.) are SNI/TCP-blocked like the sites.
  if (site === 'grouple') return tor;
  if (site && s.tor_proxied_sites.includes(site)) return tor;
  if ((site === 'exhentai' || site === 'ehentai') && s.exhentai_proxy_addr.trim()) return s.exhentai_proxy_addr.trim();
  return undefined;
}

/**
 * The ExHentai onion mirror serves gallery pages fine, but it only hosts a
 * small subset of the H@H thumbnails: most `/w/...` cover URLs from its own
 * listing answer 404 there while the same path exists on the clearnet CDN.
 * Returns equivalent clearnet URLs to try when the onion one fails.
 */
export function ehClearnetCoverFallbacks(url: string): string[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const host = u.hostname.toLowerCase();
  if (!host.endsWith('.onion') || (!host.includes('exhentai') && !host.includes('e-hentai'))) return [];
  const path = u.pathname + u.search;
  // H@H thumbnails: the shared CDN has every file the onion mirror drops.
  if (path.startsWith('/w/')) return [`https://ehgt.org${path}`, `https://s.exhentai.org${path}`];
  // Site-served thumbnails: same path on the clearnet gallery host.
  if (path.startsWith('/t/')) return [`https://exhentai.org${path}`, `https://e-hentai.org${path}`];
  return [];
}

/** A 200 with an HTML body (sad panda / login / rate-limit page) must never
 * reach the renderer or the disk cache as if it were an image. */
function assertImageBytes(buf: Buffer, url: string): void {
  const head = buf.subarray(0, 64).toString('utf-8').trimStart().toLowerCase();
  if (head.startsWith('<')) throw new Error(`HTML вместо изображения (${url})`);
}

async function fetchCoverOnce(url: string, s: Settings, accountCookieHeader: string, forceProxy?: string): Promise<Buffer> {
  const siteKey = siteKeyForUrl(url);
  const headers: Record<string, string> = {};
  const referer = coverReferer(siteKey, url);
  if (referer) headers.Referer = referer;
  const cookie = coverCookie(siteKey, url, s, accountCookieHeader);
  if (cookie) headers.Cookie = cookie;

  const proxy = forceProxy ?? coverProxy(siteKey, url, s);
  // Clearnet nhentai is routinely DNS-poisoned/rejected in RU — allow the
  // custom-DNS→Tor fallback chain on its HTTP failures.
  const allowHttpFallback = siteKey === 'nhentai' && !url.includes('.onion');
  const bytes = await httpFetchBinary(url, headers, proxy, proxy ? 90_000 : 30_000, allowHttpFallback);
  const buf = Buffer.from(bytes);
  assertImageBytes(buf, url);
  return buf;
}

function coverCookie(siteKey: string | null, url: string, s: Settings, accountCookieHeader: string): string | undefined {
  if (siteKey === 'ehgt' || siteKey === 'exhentai' || siteKey === 'ehentai') {
    // Clearnet ExHentai/E-Hentai: the active account pool cookies.
    if (url.includes('.onion')) return s.onion_cookies_raw || undefined;
    return accountCookieHeader || undefined;
  }
  if (siteKey === 'nhentai') return url.includes('.onion') ? s.nhentai_onion_cookies_raw || undefined : s.nhentai_cookies_raw || undefined;
  return undefined;
}

export async function fetchCoverBuffer(url: string, s: Settings, accountCookieHeader: string): Promise<Buffer> {
  const siteKey = siteKeyForUrl(url);
  url = withMirror(url);
  const proxy = coverProxy(siteKey, url, s);
  const onionFallbacks = ehClearnetCoverFallbacks(url);
  // H@H thumbnails (/w/…) are not served by the onion mirror — it answers an
  // HTML login/limit page (see [cover] failed … in main.log) and the clearnet
  // copy is what actually works. Trying the mirror first cost a full round-trip
  // per cover on every cold catalog, so for /w/ the clearnet copy goes first.
  let clearnetTried = false;
  if (onionFallbacks.length > 0 && /\/w\//.test(url)) {
    clearnetTried = true;
    for (const alt of onionFallbacks) {
      try {
        const buf = await fetchCoverOnce(alt, s, accountCookieHeader, proxy);
        logger.info(`[cover] H@H served from ${new URL(alt).host}`);
        return buf;
      } catch (altErr) {
        if ((altErr as any)?.ehBlocked) throw altErr;
      }
    }
  }
  try {
    return await fetchCoverOnce(url, s, accountCookieHeader);
  } catch (e) {
    // E-Hentai limit/block walls are actionable errors — do not mask them
    // with a second host that will answer the same.
    if ((e as any)?.ehBlocked) throw e;

    // Onion mirror misses most H@H thumbnails: retry the same path on the
    // clearnet CDN through the same (Tor) route. Skipped when the clearnet
    // copies were already attempted above.
    if (!clearnetTried) {
      for (const alt of onionFallbacks) {
        try {
          const buf = await fetchCoverOnce(alt, s, accountCookieHeader, proxy);
          logger.info(`[cover] onion mirror miss, served from ${new URL(alt).host}`);
          return buf;
        } catch (altErr) {
          if ((altErr as any)?.ehBlocked) throw altErr;
        }
      }
    }

    // nhentai thumbnail fallback: the HTML-reported cover (e.g. cover.webp)
    // may be blocked/missing — try classic thumb.webp / thumb.jpg on the same path.
    if (siteKey === 'nhentai') {
      const alts: string[] = [];
      if (url.includes('/cover.')) alts.push(url.replace(/\/cover\.(\w+)/, '/thumb.$1'));
      for (const alt of alts) {
        try {
          return await fetchCoverOnce(alt, s, accountCookieHeader, proxy);
        } catch {
          /* next */
        }
      }
    }

    logger.warn(`[cover] failed ${safeHost(url)}: ${(e as any)?.message ?? e}`);
    throw e;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}
