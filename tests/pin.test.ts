import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { makePinRecord, verifyPin, PinService } from '../src/main/services/pin'

describe('pin', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pin-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('makePinRecord verifies correct, rejects wrong', () => {
    const rec = makePinRecord('1234', 'salt')
    expect(verifyPin(rec, '1234')).toBe(true)
    expect(verifyPin(rec, '9999')).toBe(false)
  })

  it('PinService persists and verifies', () => {
    const s = new PinService(dir)
    expect(s.hasPin()).toBe(false)
    s.setPin('1234')
    expect(s.hasPin()).toBe(true)
    const s2 = new PinService(dir)
    expect(s2.verify('1234')).toBe(true)
    expect(s2.verify('0000')).toBe(false)
    expect(s2.removePin('0000')).toBe(false)
    expect(s2.removePin('1234')).toBe(true)
    expect(s2.hasPin()).toBe(false)
  })

  it('rejects bad pin format', () => {
    const s = new PinService(dir)
    expect(() => s.setPin('12')).toThrow()
    expect(() => s.setPin('abcd')).toThrow()
  })

  it('lockout after 3 failed verify attempts', () => {
    vi.useFakeTimers()
    try {
      const s = new PinService(dir)
      s.setPin('1234')
      expect(s.verify('0000')).toBe(false)
      expect(s.verify('0000')).toBe(false)
      expect(s.verify('0000')).toBe(false)
      const r = s.failedAttempt()
      expect(r.locked).toBe(true)
      expect(r.retryAfterSec).toBe(30)
      expect(s.verify('1234')).toBe(false)
      vi.setSystemTime(Date.now() + 31_000)
      expect(s.failedAttempt().locked).toBe(false)
      expect(s.verify('1234')).toBe(true)
      expect(s.verify('0000')).toBe(false)
      expect(s.verify('1234')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('failedAttempt is read-only', () => {
    const s = new PinService(dir)
    s.setPin('1234')
    for (let i = 0; i < 10; i++) {
      expect(s.failedAttempt().locked).toBe(false)
    }
    expect(s.verify('1234')).toBe(true)
  })

  it('verifyPin accepts legacy sha256 records', () => {
    const rec = { salt: 's', hash: createHash('sha256').update('s' + '4321').digest('hex') }
    expect(verifyPin(rec, '4321')).toBe(true)
    expect(verifyPin(rec, '0000')).toBe(false)
  })

  it('PinService upgrades legacy hash to scrypt on successful verify', () => {
    const rec = { salt: 's', hash: createHash('sha256').update('s' + '4321').digest('hex') }
    writeFileSync(join(dir, 'pin.json'), JSON.stringify(rec))
    const s = new PinService(dir)
    expect(s.verify('4321')).toBe(true)
    const reloaded = JSON.parse(readFileSync(join(dir, 'pin.json'), 'utf8')) as { algo?: string }
    expect(reloaded.algo).toBe('scrypt')
    expect(new PinService(dir).verify('4321')).toBe(true)
  })
})
