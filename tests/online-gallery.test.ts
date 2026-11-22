import { describe, it, expect } from 'vitest';
import { createServer } from 'http';
import {
  createOnlineGallery,
  setReadingPosition,
  requestPage,
  loadAheadFor,
  MAX_CONCURRENT,
  LOAD_AHEAD,
  EH_LOAD_AHEAD,
  TOR_LOAD_AHEAD,
} from '../src/main/services/online-gallery';

/** A 12-byte JPEG/Exif header followed by a page tag: page loading now rejects
 * bodies that do not look like an image (an HTML limit/login wall must never be
 * cached as a page), so test fixtures need real magic bytes. */
const jpeg = (tag: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.from(tag)]);

describe('online gallery', () => {
  it('fetches and caches pages, honors concurrency', async () => {
    let active = 0;
    let peak = 0;
    const server = createServer((req, res) => {
      active++;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active--;
        res.end(jpeg(`img-${req.url}`));
      }, 5);
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    const gid = createOnlineGallery('Test', [`http://127.0.0.1:${port}/1`, `http://127.0.0.1:${port}/2`, `http://127.0.0.1:${port}/3`]);
    const results = await Promise.all([0, 1, 2].map((i) => requestPage(gid, i, {})));
    expect(results.map((b) => b?.toString().slice(12))).toEqual(['img-/1', 'img-/2', 'img-/3']);
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT);
    server.close();
  });

  it('throws a clear error on non-200', async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end('nope');
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    const gid = createOnlineGallery('Bad', [`http://127.0.0.1:${port}/x`]);
    await expect(requestPage(gid, 0, {})).rejects.toThrow(/HTTP 404/);
    server.close();
  });

  it('serves explicitly requested pages in request order (no reversed queue)', async () => {
    // Regression: the "requested page first" tweak unshifted EVERY request, so
    // when the reader queued all 30 <img> tags at once the queue came out
    // reversed — pages 1..10 loaded, then the last ones, then the middle.
    const hits: number[] = [];
    const server = createServer((req, res) => {
      hits.push(Number((req.url ?? '/0').slice(1)));
      res.end(jpeg(`img-${req.url}`));
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    const urls = Array.from({ length: 30 }, (_, i) => `http://127.0.0.1:${port}/${i}`);
    const gid = createOnlineGallery('Order', urls);
    const pending = Array.from({ length: 30 }, (_, i) => requestPage(gid, i, {}));
    await Promise.all(pending);
    const firstTen = hits.slice(0, 10);
    expect(firstTen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(hits.indexOf(29)).toBeGreaterThan(hits.indexOf(10));
    server.close();
  });

  it('prefetches around the reading position, not from page 0', async () => {
    const hits: number[] = [];
    const server = createServer((req, res) => {
      hits.push(Number((req.url ?? '/0').slice(1)));
      res.end(jpeg(`img-${req.url}`));
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    const urls = Array.from({ length: 40 }, (_, i) => `http://127.0.0.1:${port}/${i}`);
    const gid = createOnlineGallery('Near', urls);
    setReadingPosition(gid, 20);
    await requestPage(gid, 0, {});
    await new Promise((r) => setTimeout(r, 200));
    // The explicit request wins, then the warm window is ordered by distance
    // from page 20 (nearest first) instead of walking 0,1,2,…
    expect(hits[0]).toBe(0);
    const warmed = hits.slice(1, 8);
    expect(warmed.every((i) => Math.abs(i - 20) <= 5)).toBe(true);
    expect(warmed).not.toContain(1);
    server.close();
  });

  it('reloads a page that was evicted from the read window instead of failing forever', async () => {
    // Regression: setReadingPosition() dropped the buffer but left the already
    // resolved promise on the entry, so re-requesting an evicted page settled
    // that promise, saw state !== 'done' and rejected — and because the state
    // stayed 'idle' the failed-page recovery never ran. Scrolling back more
    // than KEEP_BEHIND pages left every one of them broken for good.
    const hits = new Map<string, number>();
    const server = createServer((req, res) => {
      const url = req.url ?? '/';
      hits.set(url, (hits.get(url) ?? 0) + 1);
      res.end(jpeg(`img-${url}`));
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    const urls = Array.from({ length: 20 }, (_, i) => `http://127.0.0.1:${port}/${i}`);
    const gid = createOnlineGallery('Evict', urls);

    expect((await requestPage(gid, 0, {}))?.toString().slice(12)).toBe('img-/0');
    expect((await requestPage(gid, 1, {}))?.toString().slice(12)).toBe('img-/1');
    // Move far ahead: every page below index - KEEP_BEHIND is evicted.
    setReadingPosition(gid, 12);

    expect((await requestPage(gid, 0, {}))?.toString().slice(12)).toBe('img-/0');
    expect(hits.get('/0')).toBe(2);
    server.close();
  });
});

describe('read-ahead window', () => {
  // E-Hentai meters *viewed images*, so warming 40 pages ahead burns the quota
  // of an account that reads five. EH galleries get a short window and the
  // reader loads the rest as the position advances.
  it('keeps the wide window for ordinary sources', () => {
    expect(loadAheadFor('https://mangadex.org/x')).toBe(LOAD_AHEAD);
    expect(loadAheadFor('https://nhentai.net/g/1/')).toBe(LOAD_AHEAD);
  });

  it('narrows the window for Tor-proxied sources', () => {
    // 40 prefetched images through one circuit made the page the user is
    // reading wait behind them.
    expect(loadAheadFor('https://nhentai.net/g/1/', true)).toBe(TOR_LOAD_AHEAD);
    expect(loadAheadFor('https://remanga.org/manga/x/', true)).toBe(TOR_LOAD_AHEAD);
    expect(TOR_LOAD_AHEAD).toBeLessThan(LOAD_AHEAD);
  });

  it('narrows the window for EH hosts, clearnet and onion', () => {
    expect(loadAheadFor('https://e-hentai.org/s/abc/1-1')).toBe(EH_LOAD_AHEAD);
    expect(loadAheadFor('https://exhentai.org/s/abc/1-1')).toBe(EH_LOAD_AHEAD);
    expect(loadAheadFor('http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion/s/abc/1-1')).toBe(EH_LOAD_AHEAD);
  });

  it('stays well below the 40-page burst', () => {
    expect(EH_LOAD_AHEAD).toBeLessThan(LOAD_AHEAD);
    expect(EH_LOAD_AHEAD).toBeLessThanOrEqual(20);
  });
});
