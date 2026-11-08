import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseLimitResponse, EhLimitWatcher } from '../src/main/services/eh-limits';
import { registerEhLimitHook, handleLimitFailure, assertNotEhBlocked } from '../src/main/services/eh-limits-hook';

describe('parseLimitResponse', () => {
  it('detects image limit page', () => {
    expect(parseLimitResponse('You have exceeded your image viewing limits. Please try again later.').kind).toBe('image-limit');
  });
  it('detects usage limit with reset seconds', () => {
    const r = parseLimitResponse('You have exceeded your usage limit. Your limits will be reset in 1234 seconds.');
    expect(r.kind).toBe('usage-limit');
    expect(r.resetAfterSec).toBe(1234);
  });
  // ExHentai without a valid session answers 302 -> forums.e-hentai.org/remoteapi.php
  // -> exhentai.org/?poni=no -> …, and Chromium hands back 200 with an empty body.
  // That is an auth/Tor problem, not an image/usage quota: treating it as a limit
  // blocked both EH sources for an hour on every attempt.
  it('reports an empty body as empty, not as a limit', () => {
    expect(parseLimitResponse('').kind).toBe('empty');
    expect(parseLimitResponse('   ').kind).toBe('empty');
  });
  it('returns null for normal page', () => {
    expect(parseLimitResponse('<html><body>ok</body></html>').kind).toBe(null);
  });
});

describe('EhLimitWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  it('blocks and unblocks after reset', () => {
    vi.setSystemTime(0);
    const w = new EhLimitWatcher();
    w.block('usage-limit', 1000);
    expect(w.isBlocked()).toBe(true);
    vi.setSystemTime(1001);
    expect(w.isBlocked()).toBe(false);
  });
  it('notifies onChange subscribers', () => {
    const w = new EhLimitWatcher();
    const seen: boolean[] = [];
    w.onChange((b) => seen.push(b));
    w.block('image-limit', 60_000);
    w.clear();
    expect(seen).toEqual([true, false]);
  });
});

describe('EH limit scoping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('an exhentai limit does not block e-hentai', () => {
    const w = new EhLimitWatcher();
    registerEhLimitHook({ watcher: w });

    expect(() => {
      throw handleLimitFailure('usage-limit', 120, 'https://exhentai.org/?f_search=x');
    }).toThrow(/лимит/i);

    expect(w.isBlockedFor('exhentai')).toBe(true);
    expect(w.isBlockedFor('ehentai')).toBe(false);
    expect(() => assertNotEhBlocked('https://e-hentai.org/g/123/abc/')).not.toThrow();
    expect(() => assertNotEhBlocked('https://exhentai.org/g/123/abc/')).toThrow(/лимит/i);
  });

  it('an e-hentai limit does not block exhentai', () => {
    const w = new EhLimitWatcher();
    registerEhLimitHook({ watcher: w });
    expect(() => {
      throw handleLimitFailure('usage-limit', 120, 'https://e-hentai.org/?f_search=x');
    }).toThrow();
    expect(() => assertNotEhBlocked('https://exhentai.org/g/1/2/')).not.toThrow();
  });

  it('empty body neither blocks the source nor switches accounts', () => {
    const w = new EhLimitWatcher();
    let switched = 0;
    registerEhLimitHook({
      watcher: w,
      switchAccount: () => {
        switched++;
        return true;
      },
    });

    const err = handleLimitFailure('empty', null, 'https://exhentai.org/') as any;
    expect(err.ehBlocked).toBeUndefined();
    expect(err.message).toMatch(/пустую страницу/i);
    expect(w.isBlocked()).toBe(false);
    expect(switched).toBe(0);
    expect(() => assertNotEhBlocked('https://exhentai.org/g/1/2/')).not.toThrow();
  });

  it('unknown reset for a usage limit parks the source briefly, not for an hour', () => {
    const w = new EhLimitWatcher();
    registerEhLimitHook({ watcher: w });
    expect(() => {
      throw handleLimitFailure('usage-limit', null, 'https://e-hentai.org/');
    }).toThrow(/Сброс через 120 c/);
    expect(w.remainingSec()).toBeLessThanOrEqual(120);
  });

  it('a real image limit still parks the source for the long window', () => {
    const w = new EhLimitWatcher();
    registerEhLimitHook({ watcher: w });
    expect(() => {
      throw handleLimitFailure('image-limit', null, 'https://e-hentai.org/');
    }).toThrow(/изображений/i);
    expect(w.remainingSec()).toBeGreaterThan(3000);
  });
});
