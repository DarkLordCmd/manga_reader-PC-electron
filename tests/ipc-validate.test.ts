import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { existingDirOrArchive, httpUrl, dlTypeToken } from '../src/main/ipc/validate';

describe('ipc-validate schemas', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ipcval-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('existingDirOrArchive accepts a real folder', () => {
    expect(existingDirOrArchive.safeParse(dir).success).toBe(true);
  });
  it('existingDirOrArchive accepts an existing .zip file', () => {
    const zip = join(dir, 'a.zip');
    writeFileSync(zip, 'x');
    expect(existingDirOrArchive.safeParse(zip).success).toBe(true);
  });
  it('existingDirOrArchive rejects missing/relative/non-archive', () => {
    expect(existingDirOrArchive.safeParse(join(dir, 'nope')).success).toBe(false);
    expect(existingDirOrArchive.safeParse('relative/path').success).toBe(false);
    const txt = join(dir, 'a.txt');
    writeFileSync(txt, 'x');
    expect(existingDirOrArchive.safeParse(txt).success).toBe(false);
    expect(existingDirOrArchive.safeParse(42).success).toBe(false);
    expect(existingDirOrArchive.safeParse(`a\0b`).success).toBe(false);
  });
  it('httpUrl accepts http/https and rejects others', () => {
    expect(httpUrl.safeParse('https://exhentai.org/').success).toBe(true);
    expect(httpUrl.safeParse('http://127.0.0.1:9150/').success).toBe(true);
    expect(httpUrl.safeParse('file:///etc/passwd').success).toBe(false);
    expect(httpUrl.safeParse('javascript:alert(1)').success).toBe(false);
    expect(httpUrl.safeParse('data:text/html,x').success).toBe(false);
  });
  it('dlTypeToken accepts sane tokens', () => {
    expect(dlTypeToken.safeParse('org').success).toBe(true);
    expect(dlTypeToken.safeParse('resample').success).toBe(true);
    expect(dlTypeToken.safeParse('x y').success).toBe(false);
    expect(dlTypeToken.safeParse('').success).toBe(false);
  });
});
