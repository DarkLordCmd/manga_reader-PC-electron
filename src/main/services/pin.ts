import { createHash, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

export interface PinStore { salt: string; hash: string }

export function makePinRecord(pin: string, salt: string): PinStore {
  return { salt, hash: createHash('sha256').update(salt + pin).digest('hex') }
}

export function verifyPin(record: PinStore, pin: string): boolean {
  return makePinRecord(pin, record.salt).hash === record.hash
}

const PIN_RE = /^\d{4,8}$/

export class PinService {
  private path: string
  private fails = 0
  private lockUntil = 0

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'pin.json')
  }

  private load(): PinStore | null {
    if (!existsSync(this.path)) return null
    try { return JSON.parse(readFileSync(this.path, 'utf-8')) as PinStore } catch { return null }
  }

  hasPin(): boolean { return this.load() !== null }

  setPin(pin: string): void {
    if (!PIN_RE.test(pin)) throw new Error('PIN должен быть 4–8 цифр')
    writeFileSync(this.path, JSON.stringify(makePinRecord(pin, randomBytes(16).toString('hex')), null, 2))
    this.fails = 0
    this.lockUntil = 0
  }

  removePin(pin: string): boolean {
    const rec = this.load()
    if (!rec || !verifyPin(rec, pin)) return false
    try { rmSync(this.path) } catch { /* ignore */ }
    return true
  }

  verify(pin: string): boolean {
    const rec = this.load()
    if (!rec) return true // no pin set
    if (Date.now() < this.lockUntil) return false
    const ok = verifyPin(rec, pin)
    if (ok) { this.fails = 0; this.lockUntil = 0; return true }
    this.fails++
    if (this.fails >= 3) {
      this.lockUntil = Date.now() + 30_000
      this.fails = 0
    }
    return false
  }

  failedAttempt(): { locked: boolean; retryAfterSec: number } {
    if (Date.now() < this.lockUntil) {
      return { locked: true, retryAfterSec: Math.max(1, Math.ceil((this.lockUntil - Date.now()) / 1000)) }
    }
    return { locked: false, retryAfterSec: 0 }
  }
}
