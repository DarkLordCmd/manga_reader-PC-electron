import { describe, it, expect } from 'vitest';
import { isSafeRemoteUrl } from '../src/main/services/url-guard';

describe('isSafeRemoteUrl', () => {
  it('allows public cover hosts', () => {
    expect(isSafeRemoteUrl('https://uploads.mangadex.org/covers/a/b.jpg')).toBe(true);
    expect(isSafeRemoteUrl('https://ehgt.org/w/02/1.webp')).toBe(true);
    expect(isSafeRemoteUrl('http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion/w/1.webp')).toBe(true);
    expect(isSafeRemoteUrl('https://i.nhentai.net/galleries/1/1.jpg')).toBe(true);
  });

  it('rejects loopback and private ranges', () => {
    expect(isSafeRemoteUrl('http://127.0.0.1:8080/x')).toBe(false);
    expect(isSafeRemoteUrl('http://localhost/x')).toBe(false);
    expect(isSafeRemoteUrl('http://10.0.0.5/x')).toBe(false);
    expect(isSafeRemoteUrl('http://172.16.3.4/x')).toBe(false);
    expect(isSafeRemoteUrl('http://192.168.1.1/x')).toBe(false);
    expect(isSafeRemoteUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafeRemoteUrl('http://100.64.0.1/x')).toBe(false);
    expect(isSafeRemoteUrl('http://[::1]/x')).toBe(false);
    expect(isSafeRemoteUrl('http://[fd00::1]/x')).toBe(false);
    expect(isSafeRemoteUrl('http://[::ffff:127.0.0.1]/x')).toBe(false);
    expect(isSafeRemoteUrl('http://printer.local/x')).toBe(false);
  });

  it('rejects non-http schemes and garbage', () => {
    expect(isSafeRemoteUrl('file:///C:/Windows/win.ini')).toBe(false);
    expect(isSafeRemoteUrl('ftp://example.com/x')).toBe(false);
    expect(isSafeRemoteUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isSafeRemoteUrl('not a url')).toBe(false);
    expect(isSafeRemoteUrl('')).toBe(false);
  });
});
