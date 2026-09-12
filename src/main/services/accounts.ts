import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { parseAccountsFromJson, accountCookieHeader, type ExAccount } from './accounts-parse'

export type { ExAccount } from './accounts-parse'

interface StoredAccount { name: string; cookies: [string, string][] }

function manualAccountsPath(userDataDir: string): string {
  return join(userDataDir, 'eh_accounts.json')
}

export function loadManualAccounts(userDataDir: string): ExAccount[] {
  const p = manualAccountsPath(userDataDir)
  if (!existsSync(p)) return []
  try {
    const stored = JSON.parse(readFileSync(p, 'utf-8')) as StoredAccount[]
    return stored.map((s, i) => ({ id: i + 1, name: s.name, cookies: s.cookies }))
  } catch {
    return []
  }
}

export function saveManualAccounts(userDataDir: string, accounts: ExAccount[]): void {
  const stored: StoredAccount[] = accounts.map((a) => ({ name: a.name, cookies: a.cookies }))
  try {
    writeFileSync(manualAccountsPath(userDataDir), JSON.stringify(stored, null, 2))
  } catch { /* ignore */ }
}

const AUTOLOGIN_FILENAME = '[E-Ex-Hentai] AutoLogin.storage.json'

function findAutologinStorageFile(userDataDir: string): string | null {
  const candidates = [
    join(app.getPath('exe'), '..', AUTOLOGIN_FILENAME),
    join(process.cwd(), AUTOLOGIN_FILENAME),
    join(userDataDir, AUTOLOGIN_FILENAME)
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

export class ExAccountsService {
  accounts: ExAccount[] = []
  manualAccounts: ExAccount[] = []
  currentId = 0
  private userDataDir: string

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir
  }

  init(): void {
    const path = findAutologinStorageFile(this.userDataDir)
    let accounts: ExAccount[] = []
    if (path) {
      try {
        accounts = parseAccountsFromJson(readFileSync(path, 'utf-8'))
      } catch { accounts = [] }
    }
    this.manualAccounts = loadManualAccounts(this.userDataDir)
    const nextId = accounts.reduce((m, a) => Math.max(m, a.id), 0) + 1
    this.manualAccounts = this.manualAccounts.map((a, i) => ({ ...a, id: nextId + i }))
    this.accounts = [...accounts, ...this.manualAccounts]
    this.currentId = this.accounts[0]?.id ?? 0
  }

  current(): ExAccount | null {
    return this.accounts.find((a) => a.id === this.currentId) ?? null
  }

  currentCookieHeader(): string {
    return accountCookieHeader(this.current())
  }

  setCurrent(id: number): ExAccount | null {
    const acc = this.accounts.find((a) => a.id === id)
    if (acc) this.currentId = id
    return acc ?? null
  }

  addManual(name: string, memberId: string, passHash: string, igneous: string): ExAccount {
    const cookies: [string, string][] = []
    if (memberId.trim()) cookies.push(['ipb_member_id', memberId.trim()])
    if (passHash.trim()) cookies.push(['ipb_pass_hash', passHash.trim()])
    if (igneous.trim()) cookies.push(['igneous', igneous.trim()])
    const id = this.accounts.reduce((m, a) => Math.max(m, a.id), 0) + 1
    const acc: ExAccount = { id, name: name.trim() || `Аккаунт ${id}`, cookies }
    this.accounts.push(acc)
    this.manualAccounts.push(acc)
    this.currentId = id
    saveManualAccounts(this.userDataDir, this.manualAccounts)
    return acc
  }

  remove(id: number): void {
    this.manualAccounts = this.manualAccounts.filter((a) => a.id !== id)
    saveManualAccounts(this.userDataDir, this.manualAccounts)
    this.accounts = this.accounts.filter((a) => a.id !== id)
    if (this.currentId === id) this.currentId = this.accounts[0]?.id ?? 0
  }

  importFromContent(content: string): number {
    const imported = parseAccountsFromJson(content)
    if (imported.length === 0) return 0
    const nextId = this.accounts.reduce((m, a) => Math.max(m, a.id), 0) + 1
    const renumbered = imported.map((a, i) => ({ ...a, id: nextId + i }))
    this.manualAccounts.push(...renumbered)
    saveManualAccounts(this.userDataDir, this.manualAccounts)
    this.accounts.push(...renumbered)
    const first = renumbered[0]
    this.currentId = first.id
    return renumbered.length
  }
}