import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileAtomic } from '../src/main/services/atomic-write';

describe('writeFileAtomic', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atomic-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the content and leaves no temp file behind', () => {
    const p = join(dir, 'settings.json');
    writeFileAtomic(p, '{"a":1}');
    expect(readFileSync(p, 'utf8')).toBe('{"a":1}');
    expect(readdirSync(dir)).toEqual(['settings.json']);
  });

  it('replaces an existing file instead of appending/truncating it', () => {
    const p = join(dir, 'settings.json');
    writeFileSync(p, 'old-content-that-is-longer');
    writeFileAtomic(p, 'new');
    expect(readFileSync(p, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['settings.json']);
  });

  it('creates missing parent directories', () => {
    const p = join(dir, 'nested', 'deep', 'file.json');
    writeFileAtomic(p, 'x');
    expect(readFileSync(p, 'utf8')).toBe('x');
  });

  it('cleans up the temp file when the write fails', () => {
    // A directory as the target makes rename fail on every platform.
    const target = join(dir, 'not-a-file');
    writeFileSync(join(dir, 'keep'), 'k');
    rmSync(join(dir, 'keep'));
    writeFileAtomic(target, 'first');
    expect(() => writeFileAtomic(target + '/child.json', 'x')).toThrow();
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });

  it('supports binary payloads (encrypted blobs)', () => {
    const p = join(dir, 'tokens.bin');
    const bytes = Uint8Array.from([0, 1, 2, 255]);
    writeFileAtomic(p, bytes);
    expect([...readFileSync(p)]).toEqual([0, 1, 2, 255]);
  });
});
