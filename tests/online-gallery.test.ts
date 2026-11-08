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
} from '../src/main/services/online-gallery';

describe('online gallery', () => {
  it('fetches and caches pages, honors concurrency', async () => {
    let active = 0;
    let peak = 0;
    const server = createServer((req, res) => {
      active++;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active--;
        res.end(`img-${req.url}`);
      }, 5);
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    const gid = createOnlineGallery('Test', [`http://127.0.0.1:${port}/1`, `http://127.0.0.1:${port}/2`, `http://127.0.0.1:${port}/3`]);
    const results = await Promise.all([0, 1, 2].map((i) => requestPage(gid, i, {})));
    expect(results.map((b) => b?.toString())).toEqual(['img-/1', 'img-/2', 'img-/3']);
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
});

describe('read-ahead window', () => {
  // E-Hentai meters *viewed images*, so warming 40 pages ahead burns the quota
  // of an account that reads five. EH galleries get a short window and the
  // reader loads the rest as the position advances.
  it('keeps the wide window for ordinary sources', () => {
    expect(loadAheadFor('https://mangadex.org/x')).toBe(LOAD_AHEAD);
    expect(loadAheadFor('https://nhentai.net/g/1/')).toBe(LOAD_AHEAD);
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
