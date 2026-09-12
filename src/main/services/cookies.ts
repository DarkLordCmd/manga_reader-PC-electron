export class CookieJar {
  cookies = new Map<string, string>()

  get isEmpty(): boolean { return this.cookies.size === 0 }

  addCookie(name: string, value: string): void {
    if (!name || !value) return
    this.cookies.set(name, value)
  }

  get(name: string): string | undefined { return this.cookies.get(name) }

  toRawLines(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('\n')
  }

  headerString(): string {
    const parts = [...this.cookies.entries()]
      .filter(([k]) => k !== 'nw')
      .map(([k, v]) => `${k}=${v}`)
    if (parts.length > 0) parts.push('nw=1')
    return parts.join('; ')
  }

  static fromRaw(raw: string): CookieJar {
    return parseCookieLines(raw)
  }
}

export function parseCookieLines(raw: string): CookieJar {
  const jar = new CookieJar()

  // Try JSON array first (browser export format)
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item.name === 'string' && typeof item.value === 'string') {
          jar.addCookie(item.name, item.value)
        }
      }
      return jar
    }
  } catch { /* fall through */ }

  // Fallback: name=value per line or ;-separated
  for (const chunk of raw.split(/[\n;]/)) {
    const c = chunk.trim()
    if (!c) continue
    const eq = c.indexOf('=')
    if (eq <= 0) continue
    const name = c.slice(0, eq).trim()
    const value = c.slice(eq + 1).trim()
    if (name && value) jar.addCookie(name, value)
  }
  return jar
}

/**
 * Parses a Tampermonkey-style `.storage.json` export into a CookieJar.
 * Extracts `E/Ex_Cookies` (stripping the leading 's' type tag) and
 * cross-references the real `igneous` value from the "Share" account pool
 * (the extension exports `igneous` masked as "mystery").
 */
export function cookieJarFromTampermonkey(content: string): CookieJar {
  const jar = new CookieJar()
  let data: any
  try {
    data = JSON.parse(content)
  } catch {
    return jar
  }
  const ex = data?.data?.['E/Ex_Cookies']
  if (typeof ex === 'string') {
    const json = ex.startsWith('s') ? ex.slice(1) : ex
    try {
      const arr = JSON.parse(json)
      if (Array.isArray(arr)) {
        for (const c of arr) {
          if (c?.name && c?.value) jar.addCookie(c.name, c.value)
        }
      }
    } catch { /* ignore */ }
  }

  const needsRealIgn = jar.get('igneous') === 'mystery' || !jar.get('igneous')
  if (needsRealIgn) {
    const memberId = jar.get('ipb_member_id')
    const share = data?.data?.Share
    if (memberId && typeof share === 'string') {
      const shareJson = share.startsWith('s') ? share.slice(1) : share
      try {
        const pool = JSON.parse(shareJson)
        for (const entries of Object.values<any[]>(pool)) {
          const matches = entries.some((c) => c?.name === 'ipb_member_id' && c?.value === memberId)
          if (matches) {
            const real = entries.find((c) => c?.name === 'igneous')?.value
            if (real) jar.addCookie('igneous', real)
            break
          }
        }
      } catch { /* ignore */ }
    }
  }
  return jar
}