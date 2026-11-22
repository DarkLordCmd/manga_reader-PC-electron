import { describe, it, expect } from 'vitest';
import { isEhCdnHost, shouldUseDirectEhImage, withoutCookieHeader } from '../src/main/services/eh-image-policy';

describe('EH direct-image policy', () => {
  it('recognises the EH CDN hosts only', () => {
    expect(isEhCdnHost('https://ehgt.org/t/1.jpg')).toBe(true);
    expect(isEhCdnHost('https://abc.ehgt.org/t/1.jpg')).toBe(true);
    expect(isEhCdnHost('https://hath.network/x')).toBe(true);
    expect(isEhCdnHost('https://exhentai.org/s/abc/1-2')).toBe(false);
    expect(isEhCdnHost('http://exhentai55ld2wyap5juskbm67czulo.onion/s/abc/1-2')).toBe(false);
    expect(isEhCdnHost('not a url')).toBe(false);
  });

  it('goes direct only when enabled, proxied and on the CDN', () => {
    expect(shouldUseDirectEhImage(true, '127.0.0.1:9153', 'https://ehgt.org/t/1.jpg')).toBe(true);
    expect(shouldUseDirectEhImage(false, '127.0.0.1:9153', 'https://ehgt.org/t/1.jpg')).toBe(false);
    expect(shouldUseDirectEhImage(true, undefined, 'https://ehgt.org/t/1.jpg')).toBe(false);
    expect(shouldUseDirectEhImage(true, '127.0.0.1:9153', 'https://exhentai.org/s/a/1-2')).toBe(false);
    expect(shouldUseDirectEhImage(true, '127.0.0.1:9153', 'http://abc.onion/g/1/a/')).toBe(false);
  });

  it('strips cookies case-insensitively', () => {
    expect(withoutCookieHeader({ Cookie: 'a=b', Referer: 'https://e-hentai.org/', 'User-Agent': 'x' })).toEqual({
      Referer: 'https://e-hentai.org/',
      'User-Agent': 'x',
    });
    expect(withoutCookieHeader({ cookie: 'a=b' })).toEqual({});
  });
});
