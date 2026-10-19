import { describe, it, expect, vi } from 'vitest';
import { session } from 'electron';
import { detectsAntiBot } from '../src/main/services/anti-bot';
import { parseCookiePairs, seedSessionCookies } from '../src/main/services/browser-fetch';

describe('detectsAntiBot', () => {
  it('flags cloudflare challenge markers', () => {
    expect(detectsAntiBot(403, '<title>Just a moment...</title>')).toBe(true);
    expect(detectsAntiBot(503, 'Checking your browser before accessing')).toBe(true);
    expect(detectsAntiBot(200, 'Cf-Mitigated: challenge')).toBe(true);
  });
  it('passes normal pages', () => {
    expect(detectsAntiBot(200, '<html><body><a href="/manga/x/">ok</a></body></html>')).toBe(false);
  });
  it('flags rate limits', () => {
    expect(detectsAntiBot(429, 'too many requests')).toBe(true);
  });
});

describe('browser session cookies', () => {
  type SessionSpy = {
    cookies: { set: (opts: unknown) => Promise<void> };
    webRequest: { onBeforeSendHeaders: (...args: unknown[]) => void };
  };
  const spySession = (): SessionSpy => session.defaultSession as unknown as SessionSpy;

  it('parses pairs and preserves = inside values', () => {
    expect(parseCookiePairs('a=1; b=x=y; broken; c=')).toEqual([
      ['a', '1'],
      ['b', 'x=y'],
      ['c', ''],
    ]);
  });

  it('seeds the jar once instead of overriding request headers', async () => {
    const s = spySession();
    const setSpy = vi.spyOn(s.cookies, 'set').mockResolvedValue(undefined);
    const hookSpy = vi.spyOn(s.webRequest, 'onBeforeSendHeaders');
    await seedSessionCookies(s, 'access_token=t1; tor_session=s1', 'seed-test.onion');
    await seedSessionCookies(s, 'access_token=t1; tor_session=s1', 'seed-test.onion');
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(setSpy.mock.calls[0][0]).toMatchObject({ url: 'http://seed-test.onion/', name: 'access_token', value: 't1' });
    expect(setSpy.mock.calls[1][0]).toMatchObject({ name: 'tor_session', value: 's1' });
    // The old implementation installed a global header hook that dropped
    // jar-rotated tokens and cf_clearance.
    expect(hookSpy).not.toHaveBeenCalled();
  });

  it('re-seeds after a fresh login changes the stored cookie string', async () => {
    const s = spySession();
    const setSpy = vi.spyOn(s.cookies, 'set').mockResolvedValue(undefined);
    await seedSessionCookies(s, 'refresh_token=old', 'reseed-test.nhentai.net');
    await seedSessionCookies(s, 'refresh_token=new', 'reseed-test.nhentai.net');
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(setSpy.mock.calls[1][0]).toMatchObject({ url: 'https://reseed-test.nhentai.net/', name: 'refresh_token', value: 'new' });
  });
});
