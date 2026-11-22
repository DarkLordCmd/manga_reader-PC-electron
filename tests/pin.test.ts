import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makePinRecord, verifyPin, PinService } from '../src/main/services/pin';

describe('pin', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pin-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('makePinRecord verifies correct, rejects wrong', () => {
    const rec = makePinRecord('123456', 'salt');
    expect(verifyPin(rec, '123456')).toBe(true);
    expect(verifyPin(rec, '999999')).toBe(false);
  });

  it('PinService persists and verifies', () => {
    const s = new PinService(dir);
    expect(s.hasPin()).toBe(false);
    s.setPin('123456');
    expect(s.hasPin()).toBe(true);
    const s2 = new PinService(dir);
    expect(s2.verify('123456')).toBe(true);
    expect(s2.verify('000000')).toBe(false);
    expect(s2.removePin('000000')).toBe(false);
    expect(s2.removePin('123456')).toBe(true);
    expect(s2.hasPin()).toBe(false);
  });

  it('rejects bad pin format', () => {
    const s = new PinService(dir);
    expect(() => s.setPin('12')).toThrow();
    expect(() => s.setPin('1234')).toThrow(); // 4 digits are no longer accepted
    expect(() => s.setPin('abcd')).toThrow();
    expect(() => s.setPin('123456789')).toThrow();
  });

  it('lockout after 3 failed verify attempts', () => {
    vi.useFakeTimers();
    try {
      const s = new PinService(dir);
      s.setPin('123456');
      expect(s.verify('000000')).toBe(false);
      expect(s.verify('000000')).toBe(false);
      expect(s.verify('000000')).toBe(false);
      const r = s.failedAttempt();
      expect(r.locked).toBe(true);
      expect(r.retryAfterSec).toBe(30);
      expect(s.verify('123456')).toBe(false);
      vi.setSystemTime(Date.now() + 31_000);
      expect(s.failedAttempt().locked).toBe(false);
      expect(s.verify('123456')).toBe(true);
      expect(s.verify('000000')).toBe(false);
      expect(s.verify('123456')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives a restart: lockout state is persisted', () => {
    vi.useFakeTimers();
    try {
      const s = new PinService(dir);
      s.setPin('123456');
      for (let i = 0; i < 3; i++) s.verify('000000');
      expect(existsSync(join(dir, 'pin-lock.json'))).toBe(true);
      const restarted = new PinService(dir);
      expect(restarted.failedAttempt().locked).toBe(true);
      expect(restarted.verify('123456')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('escalates the lockout on repeated failures', () => {
    vi.useFakeTimers();
    try {
      const s = new PinService(dir);
      s.setPin('123456');
      for (let i = 0; i < 3; i++) s.verify('000000');
      expect(s.failedAttempt().retryAfterSec).toBe(30);
      vi.setSystemTime(Date.now() + 31_000);
      for (let i = 0; i < 3; i++) s.verify('000000');
      expect(s.failedAttempt().retryAfterSec).toBe(300);
      vi.setSystemTime(Date.now() + 301_000);
      for (let i = 0; i < 3; i++) s.verify('000000');
      expect(s.failedAttempt().retryAfterSec).toBe(3600);
    } finally {
      vi.useRealTimers();
    }
  });

  it('successful verify clears the persisted lock', () => {
    const s = new PinService(dir);
    s.setPin('123456');
    s.verify('000000');
    s.verify('000000');
    expect(s.verify('123456')).toBe(true);
    expect(existsSync(join(dir, 'pin-lock.json'))).toBe(false);
    expect(new PinService(dir).failedAttempt().locked).toBe(false);
  });

  it('failedAttempt is read-only', () => {
    const s = new PinService(dir);
    s.setPin('123456');
    for (let i = 0; i < 10; i++) {
      expect(s.failedAttempt().locked).toBe(false);
    }
    expect(s.verify('123456')).toBe(true);
  });

  it('verifyPin accepts legacy sha256 records', () => {
    const rec = {
      salt: 's',
      hash: createHash('sha256')
        .update('s' + '4321')
        .digest('hex'),
    };
    expect(verifyPin(rec, '4321')).toBe(true);
    expect(verifyPin(rec, '0000')).toBe(false);
  });

  it('PinService upgrades legacy hash to scrypt on successful verify', () => {
    const rec = {
      salt: 's',
      hash: createHash('sha256')
        .update('s' + '4321')
        .digest('hex'),
    };
    writeFileSync(join(dir, 'pin.json'), JSON.stringify(rec));
    const s = new PinService(dir);
    expect(s.verify('4321')).toBe(true);
    const reloaded = JSON.parse(readFileSync(join(dir, 'pin.json'), 'utf8')) as { algo?: string };
    expect(reloaded.algo).toBe('scrypt');
    expect(new PinService(dir).verify('4321')).toBe(true);
  });

  it('fails closed when pin.json is damaged (no silent unlock)', () => {
    // Regression: JSON.parse failure was indistinguishable from "no PIN set",
    // so truncating pin.json removed the lock instead of keeping it.
    const s = new PinService(dir);
    s.setPin('123456');
    writeFileSync(join(dir, 'pin.json'), '{"salt":"s","has');
    const damaged = new PinService(dir);
    expect(damaged.hasPin()).toBe(true);
    expect(damaged.verify('123456')).toBe(false);
    expect(damaged.verify('000000')).toBe(false);
  });

  it('fails closed when the PIN record has no hash/salt', () => {
    writeFileSync(join(dir, 'pin.json'), JSON.stringify({ v: 2, algo: 'scrypt' }));
    const s = new PinService(dir);
    expect(s.hasPin()).toBe(true);
    expect(s.verify('123456')).toBe(false);
  });

  it('setPin repairs a damaged PIN file', () => {
    writeFileSync(join(dir, 'pin.json'), 'not json at all');
    const s = new PinService(dir);
    s.setPin('654321');
    expect(s.hasPin()).toBe(true);
    expect(new PinService(dir).verify('654321')).toBe(true);
  });
});
