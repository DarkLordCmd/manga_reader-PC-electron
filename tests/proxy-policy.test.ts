import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/settings';
import { isOnionUrl, proxyForSource, proxyForUrl, siteKeyForUrl } from '../src/main/services/proxy-policy';

const TOR = '127.0.0.1:9153';
const settings = (over: Partial<ReturnType<typeof defaultSettings>> = {}) => ({ ...defaultSettings(), ...over });

describe('siteKeyForUrl', () => {
  it('maps the supported hosts', () => {
    expect(siteKeyForUrl('https://api.mangadex.org/x')).toBe('mangadex');
    expect(siteKeyForUrl('https://exhentai.org/g/1/x/')).toBe('exhentai');
    expect(siteKeyForUrl('https://e-hentai.org/g/1/x/')).toBe('ehentai');
    expect(siteKeyForUrl('https://ehgt.org/w/1.jpg')).toBe('ehgt');
    expect(siteKeyForUrl('https://nhentai.net/g/1/')).toBe('nhentai');
    expect(siteKeyForUrl('https://readmanga.live/x')).toBe('grouple');
    expect(siteKeyForUrl('https://one-way.work/img.jpg')).toBe('grouple');
    expect(siteKeyForUrl('https://remanga.org/manga/x/')).toBe('remanga');
    expect(siteKeyForUrl('https://unknown.example/')).toBeNull();
  });
});

describe('proxyForUrl', () => {
  it('always routes onion URLs through Tor', () => {
    const s = settings({ tor_proxied_sites: [] });
    expect(proxyForUrl('http://exhentai55ld2.onion/g/1/', s, TOR)).toBe(TOR);
    expect(isOnionUrl('http://x.onion/')).toBe(true);
  });

  it('always routes Grouple through Tor (SNI-blocked; catalog/covers already do)', () => {
    const s = settings({ tor_proxied_sites: [] });
    expect(proxyForUrl('https://readmanga.live/chapter/1', s, TOR)).toBe(TOR);
    expect(proxyForUrl('https://one-way.work/img/1.jpg', s, TOR)).toBe(TOR);
  });

  it('honours the per-source toggles (was missing for the reader/downloads)', () => {
    const s = settings({ tor_proxied_sites: ['remanga', 'senkuro', 'nhentai', 'mangashi', 'comx', 'mangalib'] });
    expect(proxyForUrl('https://remanga.org/manga/x/', s, TOR)).toBe(TOR);
    expect(proxyForUrl('https://senkuro.me/manga/x/chapter/y', s, TOR)).toBe(TOR);
    expect(proxyForUrl('https://nhentai.net/g/1/', s, TOR)).toBe(TOR);
    expect(proxyForUrl('https://manga-shi.org/manga/x/', s, TOR)).toBe(TOR);
    expect(proxyForUrl('https://com-x.life/reader/1/2', s, TOR)).toBe(TOR);
    expect(proxyForUrl('https://mangalib.me/x/read/v1/c1', s, TOR)).toBe(TOR);
  });

  it('stays direct for sources without a toggle', () => {
    const s = settings({ tor_proxied_sites: [] });
    expect(proxyForUrl('https://mangadex.org/chapter/1', s, TOR)).toBeUndefined();
    expect(proxyForUrl('https://mangamello.com/x/1/', s, TOR)).toBeUndefined();
    expect(proxyForUrl('https://unknown.example/', s, TOR)).toBeUndefined();
  });

  it('uses the E-Hentai family toggle for both hosts and the H@H CDN', () => {
    expect(proxyForUrl('https://exhentai.org/g/1/', settings({ tor_proxied_sites: ['ehentai'] }), TOR)).toBe(TOR);
    expect(proxyForUrl('https://e-hentai.org/g/1/', settings({ tor_proxied_sites: ['exhentai'] }), TOR)).toBe(TOR);
    expect(proxyForUrl('https://ehgt.org/w/1.jpg', settings({ tor_proxied_sites: ['ehentai'] }), TOR)).toBe(TOR);
  });

  it('falls back to the dedicated proxies when Tor is off for that source', () => {
    const s = settings({ tor_proxied_sites: [], exhentai_proxy_addr: '127.0.0.1:8080', mangalib_proxy_addr: '127.0.0.1:8081' });
    expect(proxyForUrl('https://exhentai.org/g/1/', s, TOR)).toBe('127.0.0.1:8080');
    expect(proxyForUrl('https://mangalib.me/x/read/v1/c1', s, TOR)).toBe('127.0.0.1:8081');
    expect(proxyForUrl('https://nhentai.net/g/1/', s, TOR)).toBeUndefined();
  });

  it('prefers Tor over the dedicated proxy when the toggle is on', () => {
    const s = settings({ tor_proxied_sites: ['exhentai'], exhentai_proxy_addr: '127.0.0.1:8080' });
    expect(proxyForUrl('https://exhentai.org/g/1/', s, TOR)).toBe(TOR);
  });
});

describe('proxyForSource', () => {
  it('maps catalog source keys to the same policy', () => {
    expect(proxyForSource('remanga', settings({ tor_proxied_sites: ['remanga'] }), TOR)).toBe(TOR);
    expect(proxyForSource('readmanga', settings(), TOR)).toBe(TOR);
    expect(proxyForSource('nhentai_onion', settings(), TOR)).toBe(TOR);
    expect(proxyForSource('mangadex', settings(), TOR)).toBeUndefined();
    expect(proxyForSource('unknown', settings(), TOR)).toBeUndefined();
  });
});
