import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';

/** Default on-disk budget for cached cover images. */
export const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

/** Persistent cover-image cache: one file per URL (sha1-named), evicted
 * oldest-first once the directory exceeds `maxBytes`. Survives restarts, so
 * library/favorites/history covers are not refetched on every launch. */
export class CoverDiskCache {
  private dir: string;
  private maxBytes: number;
  private ready: Promise<void> | null = null;
  private bytes = 0;
  private putsSinceSweep = 0;

  constructor(dir: string, maxBytes = DEFAULT_MAX_BYTES) {
    this.dir = dir;
    this.maxBytes = maxBytes;
  }

  private init(): Promise<void> {
    if (!this.ready) {
      this.ready = fs
        .mkdir(this.dir, { recursive: true })
        .then(() => this.measure())
        .catch(() => {
          /* best-effort: a broken cache dir just disables caching */
        });
    }
    return this.ready;
  }

  private async measure(): Promise<void> {
    try {
      const entries = await fs.readdir(this.dir);
      let bytes = 0;
      for (const e of entries) {
        try {
          const st = await fs.stat(join(this.dir, e));
          if (st.isFile()) bytes += st.size;
        } catch {
          /* ignore */
        }
      }
      this.bytes = bytes;
    } catch {
      /* ignore */
    }
  }

  private pathFor(url: string): string {
    return join(this.dir, createHash('sha1').update(url).digest('hex'));
  }

  async get(url: string): Promise<Buffer | null> {
    await this.init();
    try {
      return await fs.readFile(this.pathFor(url));
    } catch {
      return null;
    }
  }

  async put(url: string, buf: Buffer): Promise<void> {
    await this.init();
    try {
      await fs.writeFile(this.pathFor(url), buf);
      this.bytes += buf.length;
    } catch {
      return;
    }
    if (this.bytes > this.maxBytes || ++this.putsSinceSweep >= 64) {
      this.putsSinceSweep = 0;
      void this.sweep();
    }
  }

  private async sweep(): Promise<void> {
    if (this.bytes <= this.maxBytes) return;
    try {
      const entries = await fs.readdir(this.dir);
      const stats: { path: string; size: number; mtimeMs: number }[] = [];
      for (const e of entries) {
        try {
          const st = await fs.stat(join(this.dir, e));
          if (st.isFile()) stats.push({ path: join(this.dir, e), size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          /* ignore */
        }
      }
      stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
      let bytes = stats.reduce((n, s) => n + s.size, 0);
      for (const s of stats) {
        if (bytes <= this.maxBytes) break;
        try {
          await fs.unlink(s.path);
          bytes -= s.size;
        } catch {
          /* ignore */
        }
      }
      this.bytes = bytes;
    } catch {
      /* ignore */
    }
  }

  async clear(): Promise<void> {
    await this.init();
    this.bytes = 0;
    try {
      const entries = await fs.readdir(this.dir);
      for (const e of entries) {
        try {
          await fs.unlink(join(this.dir, e));
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  /** Change the byte budget at runtime (from settings) and evict if needed. */
  setMaxBytes(maxBytes: number): void {
    this.maxBytes = maxBytes;
    void this.sweep();
  }

  async stats(): Promise<{ files: number; bytes: number; maxBytes: number }> {
    await this.init();
    try {
      const entries = await fs.readdir(this.dir);
      let bytes = 0;
      let files = 0;
      for (const e of entries) {
        try {
          const st = await fs.stat(join(this.dir, e));
          if (st.isFile()) {
            bytes += st.size;
            files++;
          }
        } catch {
          /* ignore */
        }
      }
      this.bytes = bytes;
      return { files, bytes, maxBytes: this.maxBytes };
    } catch {
      return { files: 0, bytes: 0, maxBytes: this.maxBytes };
    }
  }
}
