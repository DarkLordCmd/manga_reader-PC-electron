import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  initPageCache,
  readPageCache,
  writePageCache,
  prune,
  flushPageCache,
  pageCacheDir,
  resetPageCacheForTests,
} from '../src/main/services/page-cache';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'page-cache-'));
  initPageCache(root, 64);
});

afterEach(() => {
  resetPageCacheForTests();
  rmSync(root, { recursive: true, force: true });
});

describe('page cache', () => {
  it('stores and returns page bytes', async () => {
    expect(readPageCache('https://e-hentai.org/s/abc/1-1')).toBeNull();
    writePageCache('https://e-hentai.org/s/abc/1-1', Buffer.from('webp-bytes'));
    await flushPageCache();
    expect(readPageCache('https://e-hentai.org/s/abc/1-1')?.toString()).toBe('webp-bytes');
  });

  it('keys by URL, so different pages do not collide', async () => {
    writePageCache('https://exhentai.org/s/a/1-1', Buffer.from('one'));
    writePageCache('https://exhentai.org/s/b/1-2', Buffer.from('two'));
    await flushPageCache();
    expect(readPageCache('https://exhentai.org/s/a/1-1')?.toString()).toBe('one');
    expect(readPageCache('https://exhentai.org/s/b/1-2')?.toString()).toBe('two');
  });

  it('ignores empty buffers and keys', () => {
    writePageCache('k', Buffer.alloc(0));
    writePageCache('', Buffer.from('x'));
    expect(readPageCache('k')).toBeNull();
    expect(readPageCache('')).toBeNull();
  });

  it('does nothing before init', () => {
    resetPageCacheForTests();
    expect(pageCacheDir()).toBeNull();
    expect(readPageCache('x')).toBeNull();
    writePageCache('x', Buffer.from('y'));
    expect(readPageCache('x')).toBeNull();
  });

  it('prunes oldest entries when over budget', async () => {
    // 64 MB budget; write 3 x 30 MB -> the newest must survive.
    const big = Buffer.alloc(30 * 1024 * 1024, 1);
    writePageCache('old', big);
    writePageCache('mid', big);
    writePageCache('new', big);
    await flushPageCache();
    await prune();
    const left = readdirSync(pageCacheDir()!).length;
    expect(left).toBeLessThanOrEqual(2);
    expect(readPageCache('new')).not.toBeNull();
  });

  it('writes are serialized and flushed', async () => {
    writePageCache('a', Buffer.from('aaa'));
    writePageCache('b', Buffer.from('bbb'));
    await flushPageCache();
    expect(readPageCache('a')?.toString()).toBe('aaa');
    expect(readPageCache('b')?.toString()).toBe('bbb');
  });
});
