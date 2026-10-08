import type { SettingsService } from '../services/settings';

export interface HttpHelperDeps {
  settings: () => SettingsService;
  effectiveTorSocks: () => string;
  exAccounts: { currentCookieHeader(): string };
}

export function makeDownloadFetchOpts(d: HttpHelperDeps): (sourceUrl: string) => { proxy?: string; cookieHeader?: string } {
  return (sourceUrl: string) => {
    const s = d.settings().get();
    const torSocks = d.effectiveTorSocks();
    const isEx = sourceUrl.includes('exhentai') || sourceUrl.includes('e-hentai.org');
    const isMl = sourceUrl.includes('mangalib');
    const useTor =
      sourceUrl.includes('.onion') ||
      (isEx && (s.tor_proxied_sites.includes('ehentai') || s.tor_proxied_sites.includes('exhentai'))) ||
      (isMl && s.tor_proxied_sites.includes('mangalib'));
    const proxy = useTor
      ? torSocks
      : isEx && s.exhentai_proxy_addr.trim()
        ? s.exhentai_proxy_addr.trim()
        : isMl && s.mangalib_proxy_addr.trim()
          ? s.mangalib_proxy_addr.trim()
          : undefined;
    const cookieHeader = sourceUrl.includes('.onion') ? s.onion_cookies_raw : isEx ? d.exAccounts.currentCookieHeader() : undefined;
    return { proxy, cookieHeader };
  };
}
