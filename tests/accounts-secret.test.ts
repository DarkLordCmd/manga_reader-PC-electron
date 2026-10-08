import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc(${s})`)),
    decryptString: vi.fn((b: Buffer) => {
      const m = b.toString('utf8').match(/^enc\((.*)\)$/s)
      if (!m) throw new Error('decrypt failed')
      return m[1]
    })
  }
}))

import { loadManualAccounts, saveManualAccounts } from '../src/main/services/accounts'

describe('eh_accounts.json at rest', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'accts-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('round-trips save/load through encryption', () => {
    saveManualAccounts(dir, [{ id: 1, name: 'A', cookies: [['ipb_pass_hash', 'abc'], ['igneous', 'xyz']] }])
    const disk = readFileSync(join(dir, 'eh_accounts.json'), 'utf8')
    expect(disk.startsWith('enc:v1:')).toBe(true)
    expect(disk).not.toContain('abc')
    const loaded = loadManualAccounts(dir)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].cookies).toEqual([['ipb_pass_hash', 'abc'], ['igneous', 'xyz']])
  })

  it('loads legacy plaintext file', () => {
    writeFileSync(join(dir, 'eh_accounts.json'), JSON.stringify([{ name: 'A', cookies: [['igneous', 'val']] }]))
    const loaded = loadManualAccounts(dir)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].cookies).toEqual([['igneous', 'val']])
  })

  it('returns empty on corrupted data', () => {
    writeFileSync(join(dir, 'eh_accounts.json'), 'enc:v1:!!!!')
    expect(loadManualAccounts(dir)).toEqual([])
  })
})
