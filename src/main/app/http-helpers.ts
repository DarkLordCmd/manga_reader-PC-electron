import type { SettingsService } from '../services/settings';
import { proxyForUrl } from '../services/proxy-policy';

export interface HttpHelperDeps {
  settings: () => SettingsService;
  effectiveTorSocks: () => string;
  exAccounts: { currentCookieHeader(): string };
}

/**
 * Per-source proxy + cookie for downloads.
 *
 * This used to be a second, narrower copy of the proxy decision (only onion,
 * E-Hentai and Mangalib). A chapter downloaded from nhentai/senkuro/manga-shi/
 * remanga/com-x with "via Tor" enabled therefore resolved and fetched every
 * page DIRECT — exactly the sources where a direct request is blocked.
 */
export function makeDownloadFetchOpts(d: HttpHelperDeps): (sourceUrl: string) => { proxy?: string; cookieHeader?: string } {
  return (sourceUrl: string) => {
    const s = d.settings().get();
    const proxy = proxyForUrl(sourceUrl, s, d.effectiveTorSocks());
    // Classify by HOSTNAME, never by substring of the whole URL: a source URL
    // with `?ref=exhentai` or `.onion` in its path used to receive the E-Hentai
    // account Cookie (ipb_pass_hash) / onion tokens and send them to that host.
    let host = '';
    try {
      host = new URL(sourceUrl).hostname.toLowerCase().replace(/\.$/, '');
    } catch {
      /* not a URL — no cookie */
    }
    const isEx =
      host === 'exhentai.org' ||
      host.endsWith('.exhentai.org') ||
      host === 'e-hentai.org' ||
      host.endsWith('.e-hentai.org') ||
      (/^exhentai/.test(host) && host.endsWith('.onion'));
    const isOnion = host.endsWith('.onion');
    const cookieHeader = isOnion ? s.onion_cookies_raw : isEx ? d.exAccounts.currentCookieHeader() : undefined;
    return { proxy, cookieHeader };
  };
}
