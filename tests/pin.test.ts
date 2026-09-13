import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
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

  it('lockout after 3 failures', () => {
    const s = new PinService(dir)
    s.setPin('1234')
    s.failedAttempt(); s.failedAttempt()
    expect(s.failedAttempt().locked).toBe(false)
    const r = s.failedAttempt()
    expect(r.locked).toBe(true)
    expect(r.retryAfterSec).toBe(30)
  })
})
