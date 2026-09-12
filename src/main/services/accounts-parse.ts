export interface ExAccount {
  id: number
  name: string
  cookies: [string, string][]
}

export function accountCookieHeader(a: ExAccount | null): string {
  if (!a) return ''
  return a.cookies.map(([k, v]) => `${k}=${v}`).join('; ')
}

export interface ParsedCookieLogin {
  ipbMemberId: string | null
  ipbPassHash: string | null
  igneous: string | null
}

/** Extracts E-Hentai login cookies from a pasted string/clipboard (JHenTai's regexes). */
export function parseCookieLogin(text: string): ParsedCookieLogin {
  const grab = (name: string): string | null => {
    const m = text.match(new RegExp(`${name}[=:]\\s?"?([^;"\\s]+)`))
    return m ? m[1] : null
  }
  return {
    ipbMemberId: grab('ipb_member_id'),
    ipbPassHash: grab('ipb_pass_hash'),
    igneous: grab('igneous')
  }
}

function cookiePairFromJson(entry: any): [string, string] | null {
  const name = entry?.name ?? entry?.key
  const value = entry?.value
  if (typeof name === 'string' && typeof value === 'string') return [name, value]
  return null
}

function stripTag(s: string): string {
  return s.startsWith('s') ? s.slice(1) : s
}

/**
 * Parses ExHentai accounts out of any shape the AutoLogin userscript can
 * export:
 *  1. The "Share" pool — `{"data":{"Share":"s{\"1\":[...cookies],...}"}}`
 *  2. The active browser session — `{"data":{"E/Ex_Cookies":"s[...]"}}`
 *  3. A bare cookie array — `[{"name":...,"value":...}, ...]`
 */
export function parseAccountsFromJson(content: string): ExAccount[] {
  let root: any
  try {
    root = JSON.parse(content)
  } catch {
    return []
  }

  if (Array.isArray(root)) {
    const cookies = root.map(cookiePairFromJson).filter((c): c is [string, string] => c !== null)
    if (cookies.length) return [{ id: 0, name: 'Импортированный аккаунт', cookies }]
    return []
  }

  const share = root?.data?.Share
  if (typeof share === 'string') {
    try {
      const parsed = JSON.parse(stripTag(share))
      if (parsed && typeof parsed === 'object') {
        const accounts: ExAccount[] = []
        for (const [key, acc] of Object.entries(parsed)) {
          const id = Number(key)
          if (!Number.isInteger(id)) continue
          const arr = acc as any[]
          const cookies = (arr ?? []).map(cookiePairFromJson).filter((c): c is [string, string] => c !== null)
          if (cookies.length) accounts.push({ id, name: `Аккаунт ${id}`, cookies })
        }
        accounts.sort((a, b) => a.id - b.id)
        if (accounts.length) return accounts
      }
    } catch { /* ignore */ }
  }

  const ex = root?.data?.['E/Ex_Cookies']
  if (typeof ex === 'string') {
    try {
      const parsed = JSON.parse(stripTag(ex))
      const cookies = (Array.isArray(parsed) ? parsed : [])
        .map(cookiePairFromJson)
        .filter((c): c is [string, string] => c !== null)
      if (cookies.length) return [{ id: 0, name: 'Текущая сессия браузера', cookies }]
    } catch { /* ignore */ }
  }

  return []
}