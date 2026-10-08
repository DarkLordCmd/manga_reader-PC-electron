import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CoverDiskCache } from '../src/main/services/cover-cache';

const dir = mkdtempSync(join(tmpdir(), 'mr-cover-'));
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('CoverDiskCache', () => {
  it('round-trips a cover by URL and misses unknown urls', async () => {
    const c = new CoverDiskCache(dir);
    await c.put('https://a/1.jpg', Buffer.from('hello'));
    expect((await c.get('https://a/1.jpg'))?.toString()).toBe('hello');
    expect(await c.get('https://a/2.jpg')).toBeNull();
  });

  it('evicts oldest files once over the byte budget', async () => {
    const cap = mkdtempSync(join(tmpdir(), 'mr-cover-cap-'));
    const c = new CoverDiskCache(cap, 20);
    await c.put('u1', Buffer.alloc(12, 1));
    await new Promise((r) => setTimeout(r, 10));
    await c.put('u2', Buffer.alloc(12, 2));
    await new Promise((r) => setTimeout(r, 10));
    await c.put('u3', Buffer.alloc(12, 3));
    await new Promise((r) => setTimeout(r, 80));
    expect(readdirSync(cap).length).toBeLessThan(3);
    rmSync(cap, { recursive: true, force: true });
  });

  it('clear removes cached files', async () => {
    const d = mkdtempSync(join(tmpdir(), 'mr-cover-clr-'));
    const c = new CoverDiskCache(d);
    await c.put('x', Buffer.from('y'));
    await c.clear();
    expect(await c.get('x')).toBeNull();
    rmSync(d, { recursive: true, force: true });
  });

  it('reports stats and evicts down when the budget shrinks', async () => {
    const d = mkdtempSync(join(tmpdir(), 'mr-cover-stat-'));
    const c = new CoverDiskCache(d, 1024);
    await c.put('a', Buffer.alloc(600, 1));
    await new Promise((r) => setTimeout(r, 10));
    await c.put('b', Buffer.alloc(600, 2));
    await new Promise((r) => setTimeout(r, 80));
    const before = await c.stats();
    expect(before.files).toBeGreaterThan(0);
    c.setMaxBytes(100);
    await new Promise((r) => setTimeout(r, 80));
    const after = await c.stats();
    expect(after.bytes).toBeLessThanOrEqual(100);
    rmSync(d, { recursive: true, force: true });
  });
});
