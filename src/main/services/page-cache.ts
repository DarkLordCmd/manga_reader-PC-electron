import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, promises as fsp } from 'fs';
import { join } from 'path';

/**
 * Disk cache for gallery pages.
 *
 * Before this, a page lived only in the in-memory gallery entry: closing the
 * chapter (or restarting the app) re-downloaded every image, which on EH means
 * hundreds of KB over Tor *and* another hit against the image quota. Caching
 * the bytes makes a re-read instant and saves the quota.
 *
 * Keyed by the stable page URL (for EH that is the `/s/…` viewer URL, so a new
 * signed CDN token does not invalidate the entry). Best-effort: any I/O error
 * degrades to "not cached".
 *
 * Writes are asynchronous and serialized through a promise chain: a page is
 * 0.37–0.53 MB, and `writeFileSync` from the main process stalled IPC/protocol
 * responses while the reader scrolled through eight concurrent loads.
 */
let dir: string | null = null;
let maxBytes = 512 * 1024 * 1024;
let writesSincePrune = 0;
let writeChain: Promise<void> = Promise.resolve();

export function initPageCache(root: string, maxMb = 512): void {
  dir = join(root, 'page-cache');
  maxBytes = Math.max(64, maxMb) * 1024 * 1024;
  mkdirSync(dir, { recursive: true });
}

export function pageCacheDir(): string | null {
  return dir;
}

function fileFor(key: string): string {
  const hash = createHash('sha1').update(key).digest('hex');
  return join(dir as string, `${hash}.bin`);
}

/** Synchronous on purpose: it runs once per page render and a 0.5 MB read from
 * the OS page cache is sub-millisecond — unlike the write path. */
export function readPageCache(key: string): Buffer | null {
  if (!dir || !key) return null;
  try {
    const p = fileFor(key);
    if (!existsSync(p)) return null;
    const buf = readFileSync(p);
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/** Fire-and-forget: serialized async write, prunes every 50 pages. */
export function writePageCache(key: string, buf: Buffer): void {
  if (!dir || !key || !buf || buf.length === 0) return;
  const p = fileFor(key);
  writeChain = writeChain.then(async () => {
    try {
      await fsp.writeFile(p, buf);
      if (++writesSincePrune >= 50) {
        writesSincePrune = 0;
        await prune();
      }
    } catch {
      /* cache is best-effort */
    }
  });
}

/** Drops the oldest entries until the cache fits its budget. */
export async function prune(): Promise<void> {
  if (!dir) return;
  try {
    const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.bin'));
    const files: { p: string; size: number; mtime: number }[] = [];
    for (const n of names) {
      const p = join(dir as string, n);
      try {
        const st = await fsp.stat(p);
        files.push({ p, size: st.size, mtime: st.mtimeMs });
      } catch {
        /* file vanished mid-prune */
      }
    }
    let total = files.reduce((a, f) => a + f.size, 0);
    if (total <= maxBytes) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (total <= maxBytes) break;
      try {
        await fsp.unlink(f.p);
        total -= f.size;
      } catch {
        /* keep pruning */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Waits for queued writes (tests, shutdown). */
export async function flushPageCache(): Promise<void> {
  await writeChain;
}

/** Test/DI hook: forget the configured directory. */
export function resetPageCacheForTests(): void {
  dir = null;
  writesSincePrune = 0;
  writeChain = Promise.resolve();
}
