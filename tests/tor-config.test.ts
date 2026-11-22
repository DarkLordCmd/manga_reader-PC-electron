import { describe, it, expect } from 'vitest';
import {
  isEmbeddedTorProxy,
  torConnectTimeoutMs,
  torIsolationAuth,
  torIsolationGroup,
} from '../src/main/services/tor-config';

describe('Tor stream isolation', () => {
  it('groups EH pages, EH images, onion and general traffic', () => {
    expect(torIsolationGroup('exhentai.org')).toBe('eh-pages');
    expect(torIsolationGroup('e-hentai.org')).toBe('eh-pages');
    expect(torIsolationGroup('ehgt.org')).toBe('eh-images');
    expect(torIsolationGroup('abc.hath.network')).toBe('eh-images');
    expect(torIsolationGroup('exhentai55ld2wyap5juskbm67czulo.onion')).toBe('onion');
    expect(torIsolationGroup('api.mangadex.org')).toBe('general');
    expect(torIsolationGroup('')).toBe('general');
  });

  it('uses a stable username per group (same pair = same circuit)', () => {
    expect(torIsolationAuth('ehgt.org')).toEqual(torIsolationAuth('hath.network'));
    expect(torIsolationAuth('ehgt.org').username).not.toBe(torIsolationAuth('exhentai.org').username);
    expect(torIsolationAuth('ehgt.org').password).toBe(torIsolationAuth('exhentai.org').password);
  });

  it('only sends credentials to the bundled SOCKS port', () => {
    expect(isEmbeddedTorProxy('127.0.0.1:9153')).toBe(true);
    expect(isEmbeddedTorProxy('socks5://localhost:9153')).toBe(true);
    expect(isEmbeddedTorProxy('127.0.0.1:9150')).toBe(false);
    expect(isEmbeddedTorProxy('http://127.0.0.1:8080')).toBe(false);
    expect(isEmbeddedTorProxy('')).toBe(false);
  });

  it('gives images a shorter connect budget than page loads', () => {
    expect(torConnectTimeoutMs('ehgt.org')).toBeLessThan(torConnectTimeoutMs('exhentai.org'));
    expect(torConnectTimeoutMs('api.mangadex.org')).toBeLessThan(torConnectTimeoutMs('exhentai.org'));
  });
});
