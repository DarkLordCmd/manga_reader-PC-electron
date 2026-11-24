import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`enc(${value})`)),
    decryptString: vi.fn((value: Buffer) => {
      const match = value.toString('utf8').match(/^enc\((.*)\)$/s);
      if (!match) throw new Error('decrypt failed');
      return match[1];
    }),
  },
}));

import { decryptSecret, isEncrypted } from '../src/main/services/secret-box';

async function freshGate(): Promise<typeof import('../src/main/services/comx-gate')> {
  vi.resetModules();
  return await import('../src/main/services/comx-gate');
}

describe('Com-X cookie sidecar protection', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'comx-cookies-'));
    path = join(dir, 'comx-cookie.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('encrypts auth cookies at rest and reloads the encrypted sidecar', async () => {
    const gate = await freshGate();
    gate.initCookieStore(dir);
    gate.setComxUserCookies('sid=super-secret; access_token=token-secret');

    const disk = readFileSync(path, 'utf8');
    expect(isEncrypted(disk)).toBe(true);
    expect(disk).not.toContain('super-secret');
    expect(disk).not.toContain('token-secret');
    expect(JSON.parse(decryptSecret(disk))).toEqual({
      'com-x.life': 'sid=super-secret; access_token=token-secret',
      'www.com-x.life': 'sid=super-secret; access_token=token-secret',
    });
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);

    const reloaded = await freshGate();
    reloaded.initCookieStore(dir);
    expect(reloaded.cookieForHost('com-x.life')).toBe('sid=super-secret; access_token=token-secret');
    expect(reloaded.cookieForHost('www.com-x.life')).toBe('sid=super-secret; access_token=token-secret');
  });

  it('migrates a legacy plaintext sidecar to encrypted storage on load', async () => {
    writeFileSync(path, JSON.stringify({ 'com-x.life': 'sid=legacy-secret' }), { mode: 0o644 });
    const gate = await freshGate();
    gate.initCookieStore(dir);

    expect(gate.cookieForHost('com-x.life')).toBe('sid=legacy-secret');
    const disk = readFileSync(path, 'utf8');
    expect(isEncrypted(disk)).toBe(true);
    expect(disk).not.toContain('legacy-secret');
    expect(JSON.parse(decryptSecret(disk))).toEqual({ 'com-x.life': 'sid=legacy-secret' });
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
