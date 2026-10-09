import { describe, it, expect } from 'vitest';
import { EhLimitWatcher } from '../src/main/services/eh-limits';
import { registerEhLimitHook, ehBlockedError, retryOnce } from '../src/main/services/eh-limits-hook';

describe('eh-limits-hook', () => {
  it('ehBlockedError carries flag and russian message', () => {
    const e = ehBlockedError('usage-limit', 123);
    expect((e as any).ehBlocked).toBe(true);
    expect(e.message).toContain('лимит');
    expect(e.message).toContain('123');
  });
  it('retryOnce retries when switchAccount returns true', async () => {
    const w = new EhLimitWatcher();
    let calls = 0;
    let switched = 0;
    registerEhLimitHook({
      watcher: w,
      switchAccount: () => {
        switched++;
        return true;
      },
    });
    const result = await retryOnce(async () => {
      calls++;
      if (calls === 1) {
        w.block('usage-limit', 60_000);
        throw ehBlockedError('usage-limit', 60);
      }
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
    expect(switched).toBe(1);
  });
  it('retryOnce does not retry when switchAccount returns false', async () => {
    const w = new EhLimitWatcher();
    registerEhLimitHook({ watcher: w, switchAccount: () => false });
    let calls = 0;
    await expect(
      retryOnce(async () => {
        calls++;
        throw ehBlockedError('usage-limit', 60);
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
