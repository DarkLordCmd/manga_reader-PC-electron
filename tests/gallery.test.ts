import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listPageFiles, galleryFromFolder } from '../src/main/services/gallery';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mr-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('listPageFiles', () => {
  it('keeps supported image extensions and sorts naturally', () => {
    for (const f of ['a10.png', 'a2.png', 'a1.png', 'notes.txt', 'b.webp']) {
      writeFileSync(join(dir, f), 'x');
    }
    expect(listPageFiles(dir).map((p) => p.split(/[\\/]/).pop())).toEqual(['a1.png', 'a2.png', 'a10.png', 'b.webp']);
  });
  it('ignores subdirectories', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', '1.jpg'), 'x');
    expect(listPageFiles(dir)).toEqual([]);
  });
});

describe('galleryFromFolder', () => {
  it('returns null for empty folder', () => {
    expect(galleryFromFolder(dir)).toBeNull();
  });
  it('uses folder name as title', () => {
    writeFileSync(join(dir, '1.jpg'), 'x');
    expect(galleryFromFolder(dir)!.title).toBe(dir.split(/[\\/]/).pop());
  });
});
