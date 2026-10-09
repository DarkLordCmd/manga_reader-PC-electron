import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc(${s})`)),
    decryptString: vi.fn((b: Buffer) => b.toString('utf8').replace(/^enc\((.*)\)$/, '$1')),
  },
}));

import { SettingsService } from '../src/main/services/settings';
import { defaultSettings } from '../src/shared/settings';

describe('SettingsService secret-at-rest', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'setsvc-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('save encrypts cookie fields on disk, get returns plaintext', () => {
    const svc = new SettingsService(dir);
    const s = { ...defaultSettings(), onion_cookies_raw: 'ipb_pass_hash=abc' };
    svc.save(s);
    const disk = readFileSync(join(dir, 'settings.json'), 'utf8');
    expect(disk).toContain('enc:v1:');
    expect(disk).not.toContain('ipb_pass_hash=abc');
    const svc2 = new SettingsService(dir);
    expect(svc2.get().onion_cookies_raw).toBe('ipb_pass_hash=abc');
  });

  it('does not rewrite already-encrypted file on load', () => {
    const svc = new SettingsService(dir);
    svc.save({ ...defaultSettings(), onion_cookies_raw: 'ipb_pass_hash=abc' });
    const first = readFileSync(join(dir, 'settings.json'));
    const svc2 = new SettingsService(dir);
    const second = readFileSync(join(dir, 'settings.json'));
    expect(svc2.get().onion_cookies_raw).toBe('ipb_pass_hash=abc');
    expect(second.equals(first)).toBe(true);
  });

  it('migrates legacy plaintext cookie fields to encrypted on first load', () => {
    const legacy = { ...defaultSettings(), nhentai_cookies_raw: 'nw=1' };
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(legacy));
    const svc = new SettingsService(dir);
    // constructor re-saves because legacy plaintext secret detected
    const disk = readFileSync(join(dir, 'settings.json'), 'utf8');
    expect(disk).toContain('enc:v1:');
    expect(svc.get().nhentai_cookies_raw).toBe('nw=1');
  });
});
