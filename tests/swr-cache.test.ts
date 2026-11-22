import { describe, it, expect, vi } from 'vitest';
import { SwrCache } from '../src/main/services/swr-cache';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('SwrCache', () => {
  it('deduplicates concurrent loads', async () => {
    const c = new SwrCache<number>(60_000, 10);
    let calls = 0;
    const load = async (): Promise<number> => {
      calls++;
      await sleep(30);
      return 42;
    };
    const [a, b] = await Promise.all([c.get('k', load), c.get('k', load)]);
    expect([a, b]).toEqual([42, 42]);
    expect(calls).toBe(1);
  });

  it('returns a stale value immediately and refreshes it in the background', async () => {
    let n = 0;
    const c = new SwrCache<number>(10, 10);
    const load = async (): Promise<number> => ++n;
    expect(await c.get('k', load)).toBe(1);
    await sleep(20); // past TTL, within stale window
    expect(await c.get('k', load)).toBe(1); // stale, refresh started
    await sleep(10);
    expect(await c.get('k', load)).toBe(2);
  });

  it('waits for the network once the stale window is over', async () => {
    let n = 0;
    const c = new SwrCache<number>(10, 10, 50);
    const load = async (): Promise<number> => ++n;
    expect(await c.get('k', load)).toBe(1);
    await sleep(70);
    expect(await c.get('k', load)).toBe(2);
  });

  it('does not cache errors and keeps stale data if a refresh fails', async () => {
    let n = 0;
    const c = new SwrCache<number>(10, 10);
    expect(await c.get('k', async () => ++n)).toBe(1);
    await sleep(20);
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    expect(await c.get('k', failing)).toBe(1);
    await sleep(10);
    expect(failing).toHaveBeenCalled();
  });
});
