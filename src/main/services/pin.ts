import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

export interface PinStore {
  v?: number;
  algo?: 'scrypt';
  salt: string;
  hash: string;
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

function scryptHash(pin: string, salt: string): string {
  return scryptSync(pin, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString('hex');
}

export function makePinRecord(pin: string, salt: string): PinStore {
  return { v: 2, algo: 'scrypt', salt, hash: scryptHash(pin, salt) };
}

export function verifyPin(record: PinStore, pin: string): boolean {
  if (record.algo === 'scrypt') {
    try {
      const expected = Buffer.from(record.hash, 'hex');
      const actual = scryptSync(pin, record.salt, expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }
  // legacy: SHA-256 в один проход (существующие установки)
  const legacy = createHash('sha256')
    .update(record.salt + pin)
    .digest('hex');
  return legacy === record.hash;
}

const PIN_RE = /^\d{4,8}$/;

export class PinService {
  private path: string;
  private fails = 0;
  private lockUntil = 0;

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'pin.json');
  }

  private load(): PinStore | null {
    if (!existsSync(this.path)) return null;
    try {
      return JSON.parse(readFileSync(this.path, 'utf-8')) as PinStore;
    } catch {
      return null;
    }
  }

  hasPin(): boolean {
    return this.load() !== null;
  }

  setPin(pin: string): void {
    if (!PIN_RE.test(pin)) throw new Error('PIN должен быть 4–8 цифр');
    writeFileSync(this.path, JSON.stringify(makePinRecord(pin, randomBytes(16).toString('hex')), null, 2));
    this.fails = 0;
    this.lockUntil = 0;
  }

  private upgradeToScrypt(pin: string): void {
    try {
      writeFileSync(this.path, JSON.stringify(makePinRecord(pin, randomBytes(16).toString('hex')), null, 2));
    } catch {
      /* ignore */
    }
  }

  removePin(pin: string): boolean {
    const rec = this.load();
    if (!rec || !verifyPin(rec, pin)) return false;
    try {
      rmSync(this.path);
    } catch {
      /* ignore */
    }
    return true;
  }

  verify(pin: string): boolean {
    const rec = this.load();
    if (!rec) return true; // no pin set
    if (Date.now() < this.lockUntil) return false;
    const ok = verifyPin(rec, pin);
    if (ok) {
      this.fails = 0;
      this.lockUntil = 0;
      if (rec.algo !== 'scrypt') this.upgradeToScrypt(pin);
      return true;
    }
    this.fails++;
    if (this.fails >= 3) {
      this.lockUntil = Date.now() + 30_000;
      this.fails = 0;
    }
    return false;
  }

  failedAttempt(): { locked: boolean; retryAfterSec: number } {
    if (Date.now() < this.lockUntil) {
      return { locked: true, retryAfterSec: Math.max(1, Math.ceil((this.lockUntil - Date.now()) / 1000)) };
    }
    return { locked: false, retryAfterSec: 0 };
  }
}
