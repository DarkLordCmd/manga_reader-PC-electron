import { mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { randomBytes } from 'crypto';

/**
 * Writes `data` to `path` atomically.
 *
 * `writeFileSync` truncates the destination before writing: a crash, a full
 * disk or a power cut mid-write leaves a truncated file behind. For the files
 * this app loads on boot (settings.json, downloads.json, pin.json, …) a
 * truncated file means "start from defaults" — i.e. lost settings, lost
 * downloads list, lost account sessions. Writing to a sibling temp file and
 * renaming over the destination makes the replacement a single filesystem
 * operation, so a reader either sees the old file or the new one, never half
 * of each.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array, opts?: { mode?: number }): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    writeFileSync(tmp, data, opts?.mode !== undefined ? { mode: opts.mode } : undefined);
    // rename() replaces an existing destination on both POSIX and Windows.
    renameSync(tmp, path);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best-effort cleanup — the original error is the one that matters */
    }
    throw e;
  }
}
