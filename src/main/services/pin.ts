import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { writeFileAtomic } from './atomic-write';

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
  // legacy: SHA-256 в один проход (существующие установки). Сравнение
  // constant-time: обычное `===` по hex-строке утекает длину общего префикса.
  try {
    const expected = Buffer.from(record.hash, 'hex');
    const actual = createHash('sha256').update(record.salt + pin).digest();
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
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
  /** pin.json exists but cannot be understood (truncated write, hand-edited…). */
  private corrupt = false;

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
      writeFileAtomic(this.lockPath, JSON.stringify(this.lock), { mode: 0o600 });
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
    this.corrupt = false;
    if (!existsSync(this.path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as Partial<PinStore> | null;
      // A record without salt/hash is not "no PIN" — it is a damaged PIN store
      // and must not be treated as an invitation to skip the lock.
      if (!parsed || typeof parsed !== 'object' || typeof parsed.salt !== 'string' || typeof parsed.hash !== 'string' || !parsed.salt || !parsed.hash) {
        this.corrupt = true;
        return null;
      }
      return parsed as PinStore;
    } catch {
      this.corrupt = true;
      return null;
    }
  }

  /** True when a PIN file exists. A damaged file still counts as "PIN set":
   * failing open here would silently disable the lock. */
  hasPin(): boolean {
    if (!existsSync(this.path)) return false;
    return this.load() !== null || this.corrupt;
  }

  setPin(pin: string, current?: string): void {
    if (!PIN_RE.test(pin)) throw new Error('PIN должен быть 6–8 цифр');
    // Changing an existing PIN requires proving knowledge of the current one in
    // the MAIN process too: the renderer-only check could be skipped by any
    // renderer-side code, silently replacing the lock. A DAMAGED file has no
    // valid record to verify against — allow the repair (the app is locked out
    // anyway, and a local attacker could just delete userData).
    if (this.hasPin() && !this.corrupt && !this.verify(current ?? '')) throw new Error('Неверный текущий PIN');
    writeFileAtomic(this.path, JSON.stringify(makePinRecord(pin, randomBytes(16).toString('hex')), null, 2), { mode: 0o600 });
    this.corrupt = false;
    this.resetLock();
  }

  private upgradeToScrypt(pin: string): void {
    try {
      writeFileAtomic(this.path, JSON.stringify(makePinRecord(pin, randomBytes(16).toString('hex')), null, 2), { mode: 0o600 });
    } catch {
      /* ignore */
    }
  }

  removePin(pin: string): boolean {
    if (!this.hasPin()) return false;
    // Route through verify(): the raw verifyPin() check bypassed the lockout and
    // failed-attempt counter, so pinRemovePin could be used to brute-force the
    // PIN without ever waiting.
    if (!this.verify(pin)) return false;
    try {
      rmSync(this.path);
    } catch {
      /* ignore */
    }
    this.corrupt = false;
    this.resetLock();
    return true;
  }

  verify(pin: string): boolean {
    const rec = this.load();
    // No PIN configured at all → unlocked. A damaged pin.json is NOT the same
    // thing: fail closed, otherwise truncating the file removes the lock.
    if (!rec) return !this.corrupt;
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
