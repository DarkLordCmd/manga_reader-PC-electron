import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DownloadManager } from '../src/main/services/download-manager';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('DownloadManager', () => {
  let dir: string;
  let persist: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dl-'));
    persist = join(dir, 'downloads.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function makeManager(fetchBin?: any, broadcast = (_t: any) => {}): DownloadManager {
    const fb = fetchBin ?? (async (url: string) => new Uint8Array([1, 2, 3]));
    return new DownloadManager(join(dir, 'downloads'), persist, { fetchBinary: fb, broadcast });
  }

  it('downloads all pages to outDir and completes', async () => {
    const m = makeManager();
    const t = await m.add(
      'https://x/g/1/',
      async () => ({
        title: 'Test',
        pageUrls: ['u1', 'u2', 'u3'],
        coverUrl: null,
        source: 'S',
        referer: null,
        mangaId: null,
        seriesId: 's',
      }),
      {},
    );
    expect(t).not.toBeNull();
    await m.waitIdle();
    expect(t!.state).toBe('completed');
    expect(existsSync(join(t!.outDir, '001.bin'))).toBe(true);
    expect(existsSync(join(t!.outDir, '003.bin'))).toBe(true);
  });

  it('dedups by sourceUrl', async () => {
    const m = makeManager();
    await m.add(
      'https://x/g/1/',
      async () => ({
        title: 'T',
        pageUrls: ['u1'],
        coverUrl: null,
        source: 'S',
        referer: null,
        mangaId: null,
        seriesId: 's',
      }),
      {},
    );
    const t2 = await m.add(
      'https://x/g/1/',
      async () => ({ title: 'T', pageUrls: [], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's' }),
      {},
    );
    expect(t2).toBeNull();
    await m.waitIdle();
  });

  it('pause stops work, resume finishes', async () => {
    let gate: (() => void) | null = null;
    const p = new Promise<void>((r) => {
      gate = r;
    });
    const m = makeManager(async () => {
      await p;
      return new Uint8Array([9]);
    });
    const t = await m.add(
      'https://x/g/1/',
      async () => ({
        title: 'T',
        pageUrls: ['u1', 'u2'],
        coverUrl: null,
        source: 'S',
        referer: null,
        mangaId: null,
        seriesId: 's',
      }),
      {},
    );
    await delay(10);
    m.pause(t!.id);
    expect(t!.state).toBe('paused');
    (gate as any)!();
    m.resume(t!.id);
    await m.waitIdle();
    expect(t!.state).toBe('completed');
  });

  it('pause/resume race does not double-run or duplicate pages', async () => {
    const counts: Record<string, number> = {};
    let releaseAll!: () => void;
    const released = new Promise<void>((r) => {
      releaseAll = r;
    });
    const m = makeManager(async (url: string) => {
      counts[url] = (counts[url] ?? 0) + 1;
      await released;
      return new Uint8Array([9]);
    });
    const t = await m.add(
      'https://x/g/1/',
      async () => ({
        title: 'T',
        pageUrls: ['u1', 'u2', 'u3'],
        coverUrl: null,
        source: 'S',
        referer: null,
        mangaId: null,
        seriesId: 's',
      }),
      {},
    );
    await delay(20);
    m.pause(t!.id);
    expect(t!.state).toBe('paused');
    releaseAll();
    await delay(20);
    m.resume(t!.id);
    await m.waitIdle();
    expect(t!.state).toBe('completed');
    expect((counts['u2'] ?? 0) + (counts['u3'] ?? 0)).toBe(2);
    expect(counts['u1']).toBeLessThanOrEqual(2);
    expect(m.list()[0].completedPages).toEqual([0, 1, 2]);
    expect(existsSync(join(t!.outDir, '003.bin'))).toBe(true);
  });

  it('resumes from existing files on loadPersisted', async () => {
    const out = join(dir, 'downloads', 'test-1');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, '001.bin'), 'x');
    const m = makeManager();
    writeFileSync(
      persist,
      JSON.stringify([
        {
          id: '1',
          title: 'Test',
          sourceUrl: 'https://x/g/1/',
          pageUrls: ['u1', 'u2', 'u3'],
          headers: {},
          outDir: out,
          state: 'running',
          priority: 0,
          completedPages: [0],
          totalPages: 3,
          addedAt: 0,
        },
      ]),
    );
    m.loadPersisted();
    const t = m.list()[0];
    expect(t.completedPages).toEqual([0]);
    expect(t.state).toBe('queued');
    await m.waitIdle();
    expect(m.list()[0].state).toBe('completed');
  });

  it('priority order', async () => {
    const order: string[] = [];
    let gate: (() => void) | null = null;
    const p = new Promise<void>((r) => {
      gate = r;
    });
    const m = makeManager(async (url: string) => {
      order.push(url);
      await p;
      return new Uint8Array([1]);
    });
    const a = await m.add(
      'https://x/g/a/',
      async () => ({ title: 'A', pageUrls: ['a1'], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 'a' }),
      {},
    );
    const b = await m.add(
      'https://x/g/b/',
      async () => ({ title: 'B', pageUrls: ['b1'], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 'b' }),
      {},
    );
    m.setPriority(b!.id, 10);
    (gate as any)!();
    await m.waitIdle();
    expect(order.indexOf('b1')).toBeLessThan(order.indexOf('a1'));
  });
});
