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

/** 6+ digits for new PINs: a 4-digit PIN is 10k candidates, which a local
 * attacker can burn through across restarts even with the lockout. */
const PIN_RE = /^\d{6,8}$/;

/** Lockout stages: 30 s → 5 min → 1 h. Persisted so restarting the app does not
 * hand the attacker a fresh set of guesses. */
const LOCK_STEPS_MS = [30_000, 300_000, 3_600_000];

interface PinLock {
  fails: number;
  lockUntil: number;
  stage: number;
}

export class PinService {
  private path: string;
  private lockPath: string;
  private lock: PinLock;

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'pin.json');
    this.lockPath = join(userDataDir, 'pin-lock.json');
    this.lock = this.loadLock();
  }

  private loadLock(): PinLock {
    try {
      const j = JSON.parse(readFileSync(this.lockPath, 'utf-8')) as Partial<PinLock>;
      return {
        fails: Math.max(0, Number(j.fails) || 0),
        lockUntil: Math.max(0, Number(j.lockUntil) || 0),
        stage: Math.min(LOCK_STEPS_MS.length - 1, Math.max(0, Number(j.stage) || 0)),
      };
    } catch {
      return { fails: 0, lockUntil: 0, stage: 0 };
    }
  }

  private saveLock(): void {
    try {
      writeFileSync(this.lockPath, JSON.stringify(this.lock), { mode: 0o600 });
    } catch {
      /* lockout is best-effort */
    }
  }

  private resetLock(): void {
    this.lock = { fails: 0, lockUntil: 0, stage: 0 };
    try {
      rmSync(this.lockPath, { force: true });
    } catch {
      /* ignore */
    }
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
    if (!PIN_RE.test(pin)) throw new Error('PIN должен быть 6–8 цифр');
    writeFileSync(this.path, JSON.stringify(makePinRecord(pin, randomBytes(16).toString('hex')), null, 2), { mode: 0o600 });
    this.resetLock();
  }

  private upgradeToScrypt(pin: string): void {
    try {
      writeFileSync(this.path, JSON.stringify(makePinRecord(pin, randomBytes(16).toString('hex')), null, 2), { mode: 0o600 });
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
    this.resetLock();
    return true;
  }

  verify(pin: string): boolean {
    const rec = this.load();
    if (!rec) return true; // no pin set
    if (Date.now() < this.lock.lockUntil) return false;
    const ok = verifyPin(rec, pin);
    if (ok) {
      this.resetLock();
      if (rec.algo !== 'scrypt') this.upgradeToScrypt(pin);
      return true;
    }
    this.lock.fails++;
    if (this.lock.fails >= 3) {
      const delay = LOCK_STEPS_MS[this.lock.stage] ?? LOCK_STEPS_MS[0];
      this.lock.lockUntil = Date.now() + delay;
      this.lock.fails = 0;
      this.lock.stage = Math.min(LOCK_STEPS_MS.length - 1, this.lock.stage + 1);
    }
    this.saveLock();
    return false;
  }

  failedAttempt(): { locked: boolean; retryAfterSec: number } {
    if (Date.now() < this.lock.lockUntil) {
      return { locked: true, retryAfterSec: Math.max(1, Math.ceil((this.lock.lockUntil - Date.now()) / 1000)) };
    }
    return { locked: false, retryAfterSec: 0 };
  }
}
