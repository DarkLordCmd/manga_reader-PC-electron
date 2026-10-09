import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseLimitResponse, EhLimitWatcher } from '../src/main/services/eh-limits';

describe('parseLimitResponse', () => {
  it('detects image limit page', () => {
    expect(parseLimitResponse('You have exceeded your image viewing limits. Please try again later.').kind).toBe('image-limit');
  });
  it('detects usage limit with reset seconds', () => {
    const r = parseLimitResponse('You have exceeded your usage limit. Your limits will be reset in 1234 seconds.');
    expect(r.kind).toBe('usage-limit');
    expect(r.resetAfterSec).toBe(1234);
  });
  it('detects sad panda empty body', () => {
    expect(parseLimitResponse('   ').kind).toBe('sad-panda');
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
