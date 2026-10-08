import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc(${s})`)),
    decryptString: vi.fn((b: Buffer) => {
      const m = b.toString('utf8').match(/^enc\((.*)\)$/);
      if (!m) throw new Error('decrypt failed');
      return m[1];
    }),
  },
}));

import { isEncrypted, encryptSecret, decryptSecret } from '../src/main/services/secret-box';
import { safeStorage } from 'electron';

describe('secret-box', () => {
  beforeEach(() => {
    (safeStorage.isEncryptionAvailable as any).mockReturnValue(true);
  });
  it('round-trips through encrypt/decrypt', () => {
    const enc = encryptSecret('hello');
    expect(isEncrypted(enc!)).toBe(true);
    expect(decryptSecret(enc!)).toBe('hello');
  });
  it('empty string stays empty', () => {
    expect(encryptSecret('')).toBe('');
  });
  it('legacy plaintext passes through decrypt', () => {
    expect(decryptSecret('ipb_pass_hash=abc')).toBe('ipb_pass_hash=abc');
    expect(decryptSecret('')).toBe('');
  });
  it('returns null when encryption unavailable', () => {
    (safeStorage.isEncryptionAvailable as any).mockReturnValue(false);
    expect(encryptSecret('x')).toBeNull();
  });
  it('garbage ciphertext decrypts to empty string', () => {
    expect(decryptSecret('enc:v1:!!!not-base64!!!')).toBe('');
  });
});
