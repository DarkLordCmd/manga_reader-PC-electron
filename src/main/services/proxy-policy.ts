import type { Settings } from '@shared/settings';

/**
 * Single source of truth for "should this URL go through Tor?".
 *
 * Before this module the decision was copy-pasted in five places and the copies
 * had drifted: the catalog and covers routed Grouple (Readmanga/Mintmanga/
 * Mangapoisk) through Tor, but the reader opened the chapter DIRECT (blocked
 * network → 30 s timeouts, then every page image failed). Downloads ignored the
 * nhentai/senkuro/mangashi/remanga/comx toggles entirely, and Remanga/Senkuro/
 * MangaMello/Com-X lost the proxy between resolve and page loading. Every one
 * of those paths now asks this module.
 */

export type SiteKey =
  | 'mangadex'
  | 'ehgt'
  | 'exhentai'
  | 'ehentai'
  | 'nhentai'
  | 'senkuro'
  | 'remanga'
  | 'mangashi'
  | 'mangalib'
  | 'hentailib'
  | 'comx'
  | 'grouple'
  | 'mangamello';

/** Resolves the logical site a URL belongs to. Order matters: more specific
 * hosts first. */
export function siteKeyForUrl(url: string): SiteKey | null {
  const l = (url ?? '').toLowerCase();
  if (!l) return null;
  if (l.includes('mangadex')) return 'mangadex';
  if (l.includes('ehgt.org') || l.includes('hath.network')) return 'ehgt';
  if (l.includes('exhentai')) return 'exhentai';
  if (l.includes('e-hentai.org') || l.includes('e-hentai.')) return 'ehentai';
  if (l.includes('nhentai')) return 'nhentai';
  if (l.includes('senkuro')) return 'senkuro';
  if (l.includes('remanga')) return 'remanga';
  if (l.includes('manga-shi')) return 'mangashi';
  if (l.includes('hentailib') || l.includes('hentaicdn.org')) return 'hentailib';
  if (l.includes('mangalib') || l.includes('cdnlibs.org') || l.includes('imglib.info') || l.includes('imgslib.link')) return 'mangalib';
  if (l.includes('com-x.life')) return 'comx';
  if (l.includes('one-way.work') || l.includes('readmanga') || l.includes('mintmanga') || l.includes('mangapoisk')) return 'grouple';
  if (l.includes('mangamello')) return 'mangamello';
  return null;
}

export function isOnionUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.onion');
  } catch {
    return /\.onion(?:[/:?]|$)/i.test(url ?? '');
  }
}

/** Tor SOCKS address for this URL, or undefined when a direct connection is
 * correct. `torSocks` is the effective daemon address (embedded > settings). */
export function proxyForUrl(url: string, s: Settings, torSocks: string): string | undefined {
  if (isOnionUrl(url)) return torSocks;
  const site = siteKeyForUrl(url);
  if (!site) return undefined;
  const tor = s.tor_proxied_sites ?? [];
  switch (site) {
    case 'mangadex':
      return tor.includes('mangadex') ? torSocks : undefined;
    case 'grouple':
      // Grouple hosts are SNI/TCP-blocked on RU networks; the catalog, chapter
      // list and covers always use Tor, so the reader must too.
      return torSocks;
    case 'ehgt':
    case 'exhentai':
    case 'ehentai':
      // One toggle covers the whole E-Hentai family (both clearnet hosts and
      // the H@H CDN), matching the catalog's behaviour.
      if (tor.includes('ehentai') || tor.includes('exhentai')) return torSocks;
      return s.exhentai_proxy_addr.trim() || undefined;
    case 'mangalib':
    case 'hentailib':
      if (tor.includes('mangalib')) return torSocks;
      return s.mangalib_proxy_addr.trim() || undefined;
    default:
      return tor.includes(site) ? torSocks : undefined;
  }
}

/** Representative origin per catalog source key, so the same policy can decide
 * the catalog/search proxy without a URL. */
const SOURCE_ORIGINS: Record<string, string> = {
  mangadex: 'https://mangadex.org/',
  remanga: 'https://remanga.org/',
  senkuro: 'https://senkuro.me/',
  mangashi: 'https://manga-shi.org/',
  mangamello: 'https://mangamello.com/',
  nhentai: 'https://nhentai.net/',
  nhentai_onion: 'http://nhentai.net.onion/',
  ehentai: 'https://e-hentai.org/',
  exhentai: 'https://exhentai.org/',
  exhentai_onion: 'http://exhentai.org.onion/',
  comx: 'https://com-x.life/',
  mangalib: 'https://mangalib.me/',
  hentailib: 'https://hentailib.me/',
  readmanga: 'https://readmanga.live/',
  mintmanga: 'https://mintmanga.live/',
  mangapoisk: 'https://mangapoisk.ru/',
};

/** Catalog-source variant of {@link proxyForUrl}. */
export function proxyForSource(source: string, s: Settings, torSocks: string): string | undefined {
  const origin = SOURCE_ORIGINS[source];
  return origin ? proxyForUrl(origin, s, torSocks) : undefined;
}
