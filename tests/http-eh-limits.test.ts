import { describe, it, expect, afterEach, vi } from 'vitest';
import { httpFetch } from '../src/main/services/http';
import { EhLimitWatcher } from '../src/main/services/eh-limits';
import { registerEhLimitHook, assertNotEhBlocked } from '../src/main/services/eh-limits-hook';

// The exact shape the app sees today: ExHentai without a valid session goes
// 302 -> forums.e-hentai.org/remoteapi.php -> exhentai.org/?poni=no -> …, and
// Chromium finishes the chain with a 200 that has a zero-length body.
describe('E-Hentai limit walls through httpFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not park the source on an empty ExHentai body', async () => {
    const w = new EhLimitWatcher();
    registerEhLimitHook({ watcher: w });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } })),
    );

    await expect(httpFetch({ url: 'https://exhentai.org/?f_search=test' })).rejects.toThrow(/пустую страницу/i);
    expect(w.isBlocked()).toBe(false);
    expect(() => assertNotEhBlocked('https://exhentai.org/g/1/2/')).not.toThrow();
    expect(() => assertNotEhBlocked('https://e-hentai.org/g/1/2/')).not.toThrow();
  });

  it('parks only the host that hit the usage wall, for the advertised reset', async () => {
    const w = new EhLimitWatcher();
    registerEhLimitHook({ watcher: w });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('You have exceeded your usage limit. Your limits will be reset in 30 seconds.', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=UTF-8' },
          }),
      ),
    );

    await expect(httpFetch({ url: 'https://e-hentai.org/?f_search=test' })).rejects.toThrow(/Сброс через 30 c/);
    expect(w.remainingSec()).toBeLessThanOrEqual(30);
    expect(() => assertNotEhBlocked('https://e-hentai.org/g/1/2/')).toThrow(/лимит/i);
    expect(() => assertNotEhBlocked('https://exhentai.org/g/1/2/')).not.toThrow();
  });
});
