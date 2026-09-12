import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { parseAccountsFromJson, accountCookieHeader, parseCookieLogin, type ExAccount } from './accounts-parse'
import { httpFetch } from './http'

export type { ExAccount } from './accounts-parse'
export { parseCookieLogin } from './accounts-parse'

function parseSetCookieValue(setCookie: string): [string, string] | null {
  const eq = setCookie.indexOf('=')
  if (eq <= 0) return null
  const name = setCookie.slice(0, eq).trim()
  const value = setCookie.slice(eq + 1).split(';')[0].trim()
  if (!name || value === '') return null
  return [name, value]
}

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

  /**
   * Password login to E-Hentai via the forums (same flow as JHenTai):
   * POST `act=Login&CODE=01` with username/password, capture the session
   * cookies from the redirect response (ipb_member_id / ipb_pass_hash),
   * then store them as the current clearnet account.
   */
  async passwordLogin(user: string, pass: string): Promise<{ ok: boolean; message: string }> {
    if (!user.trim() || !pass) return { ok: false, message: 'Введи логин и пароль' }
    const r = await httpFetch({
      url: 'https://forums.e-hentai.org/index.php?act=Login&CODE=01',
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://forums.e-hentai.org/index.php?'
      },
      body: new URLSearchParams({
        referer: 'https://forums.e-hentai.org/index.php?',
        b: '',
        bt: '',
        UserName: user,
        PassWord: pass,
        CookieDate: '365'
      }).toString(),
      timeoutMs: 30_000
    })

    const cookies: [string, string][] = []
    for (const sc of r.setCookies) {
      const eq = sc.indexOf('=')
      if (eq <= 0) continue
      const name = sc.slice(0, eq).trim()
      const value = sc.slice(eq + 1).split(';')[0].trim()
      if (name && value) cookies.push([name, value])
    }

    if (r.status >= 400 || r.status === 0) {
      return { ok: false, message: `Ошибка входа (HTTP ${r.status})` }
    }

    const loggedIn = cookies.some(([n]) => n === 'ipb_member_id')
    if (!loggedIn) {
      return { ok: false, message: 'Не удалось войти — проверь логин и пароль' }
    }

    const id = this.accounts.reduce((m, a) => Math.max(m, a.id), 0) + 1
    const acc: ExAccount = { id, name: user.trim(), cookies }
    this.accounts.push(acc)
    this.manualAccounts.push(acc)
    this.currentId = id
    saveManualAccounts(this.userDataDir, this.manualAccounts)
    return { ok: true, message: `Вход выполнен: ${user.trim()}` }
  }

  private persist(): void {
    saveManualAccounts(this.userDataDir, this.manualAccounts)
  }

  /** Merges cookies into the current account (creating one if needed). */
  mergeCookies(cookies: [string, string][], name = 'Cookie-вход'): ExAccount {
    let acc = this.current()
    if (!acc) {
      const id = this.accounts.reduce((m, a) => Math.max(m, a.id), 0) + 1
      acc = { id, name, cookies: [] }
      this.accounts.push(acc)
      this.manualAccounts.push(acc)
      this.currentId = id
    } else if (acc.name === 'Cookie-вход' && name !== 'Cookie-вход') {
      acc.name = name
    }
    for (const [n, v] of cookies) {
      const existing = acc.cookies.find(([cn]) => cn === n)
      if (existing) existing[1] = v
      else acc.cookies.push([n, v])
    }
    const manual = this.manualAccounts.find((a) => a.id === acc!.id)
    if (!manual) this.manualAccounts.push(acc)
    this.persist()
    return acc
  }

  removeCookies(names: string[]): void {
    const acc = this.current()
    if (!acc) return
    acc.cookies = acc.cookies.filter(([n]) => !names.includes(n))
    this.persist()
  }

  /** Parses raw Set-Cookie headers (from any EH response) and merges the session cookies. */
  mergeSetCookies(setCookies: string[]): void {
    const cookies: [string, string][] = []
    for (const sc of setCookies) {
      const pair = parseSetCookieValue(sc)
      if (!pair) continue
      const [name, value] = pair
      if (name === '__utmp') continue
      if (name === 'igneous' && value === 'mystery') continue
      cookies.push(pair)
    }
    if (cookies.length > 0) this.mergeCookies(cookies)
  }

  private headerFor(acc: ExAccount): Record<string, string> {
    return { Cookie: accountCookieHeader(acc) }
  }

  private static parseProfileUsername(html: string): string | null {
    const title = html.match(/<title>\s*Profile\s*[-–]\s*([^<]+?)\s*[-–]/i)
    if (title && title[1].trim()) return title[1].trim()
    const popup = html.match(/<span[^>]*class="[^"]*popupctrl[^"]*"[^>]*>([^<]+)<\/span>/i)
    if (popup && popup[1].trim()) return popup[1].trim()
    return null
  }

  /**
   * JHenTai-style cookie login: store ipb_member_id / ipb_pass_hash (and
   * igneous if provided), fetch home.php to obtain the session `sk` cookie,
   * then verify via the forums profile page. Removes the cookies on failure.
   */
  async cookieLogin(opts: { ipbMemberId: string; ipbPassHash: string; igneous?: string | null; verify?: boolean }): Promise<{ ok: boolean; message: string }> {
    const ipbMemberId = opts.ipbMemberId?.trim()
    const ipbPassHash = opts.ipbPassHash?.trim()
    if (!ipbMemberId || !ipbPassHash) {
      return { ok: false, message: 'Нужны ipb_member_id и ipb_pass_hash' }
    }
    const initial: [string, string][] = [['ipb_member_id', ipbMemberId], ['ipb_pass_hash', ipbPassHash]]
    const ign = opts.igneous?.trim()
    const hasIgn = !!ign && ign !== 'mystery' && ign !== 'deleted' && ign !== 'null'
    if (hasIgn) initial.push(['igneous', ign!])
    const acc = this.mergeCookies(initial, 'Cookie-вход')

    if (opts.verify === false) {
      return { ok: true, message: 'Куки сохранены (без проверки)' }
    }

    try {
      const home = await httpFetch({ url: 'https://e-hentai.org/home.php', headers: this.headerFor(acc), timeoutMs: 20_000 })
      this.mergeSetCookies(home.setCookies)
    } catch { /* sk is best-effort */ }

    try {
      const forums = await httpFetch({
        url: `https://forums.e-hentai.org/index.php?showuser=${ipbMemberId}`,
        headers: this.headerFor(this.current() ?? acc),
        timeoutMs: 20_000
      })
      this.mergeSetCookies(forums.setCookies)
      const guest = forums.text.includes('userlinksguest')
      const username = ExAccountsService.parseProfileUsername(forums.text)
      if (guest || !username) {
        this.removeCookies(['ipb_member_id', 'ipb_pass_hash', 'igneous', 'sk'])
        return { ok: false, message: 'Куки недействительны — вход не выполнен' }
      }
      this.mergeCookies([['__userName', username]])
      return { ok: true, message: `Вход выполнен: ${username}` }
    } catch (e: any) {
      this.removeCookies(['ipb_member_id', 'ipb_pass_hash', 'igneous', 'sk'])
      return { ok: false, message: `Ошибка проверки: ${e?.message ?? e}` }
    }
  }

  /**
   * Obtains the real `igneous` cookie for ExHentai by requesting the EX index
   * with only ipb_member_id + ipb_pass_hash and reading Set-Cookie (JHenTai's
   * "refresh igneous"). 'mystery' means the account has no EX access (sad panda).
   */
  async refreshIgneous(): Promise<{ ok: boolean; message: string }> {
    const acc = this.current()
    if (!acc) return { ok: false, message: 'Сначала войди по кукам/паролю' }
    const member = acc.cookies.find(([n]) => n === 'ipb_member_id')
    const hash = acc.cookies.find(([n]) => n === 'ipb_pass_hash')
    if (!member || !hash) return { ok: false, message: 'Нет ipb_member_id / ipb_pass_hash' }
    let r
    try {
      r = await httpFetch({
        url: 'https://exhentai.org/',
        headers: { Cookie: `${member[0]}=${member[1]}; ${hash[0]}=${hash[1]}` },
        timeoutMs: 30_000
      })
    } catch (e: any) {
      return { ok: false, message: `Ошибка запроса: ${e?.message ?? e}` }
    }
    const sc = r.setCookies.find((c) => c.slice(0, c.indexOf('=')).trim() === 'igneous')
    if (!sc) return { ok: false, message: 'Sad panda — igneous не выдан (проверь доступ к ExHentai)' }
    const value = sc.slice(sc.indexOf('=') + 1).split(';')[0].trim()
    if (value === 'mystery' || value === '') {
      return { ok: false, message: 'Sad panda — у аккаунта нет доступа к ExHentai' }
    }
    this.mergeCookies([['igneous', value]])
    return { ok: true, message: `igneous получен (${value.slice(0, 8)}…)` }
  }
}