function splitAlphaNumeric(s: string): string[] {
  const chunks: string[] = []
  let current = ''
  let currentIsDigit: boolean | null = null
  for (const ch of s) {
    const isDigit = ch >= '0' && ch <= '9'
    if (currentIsDigit === null || currentIsDigit === isDigit) {
      current += ch
    } else {
      if (current) chunks.push(current)
      current = ch
    }
    currentIsDigit = isDigit
  }
  if (current) chunks.push(current)
  return chunks
}

export function naturalCompare(a: string, b: string): number {
  const ac = splitAlphaNumeric(a)
  const bc = splitAlphaNumeric(b)
  const n = Math.min(ac.length, bc.length)
  for (let i = 0; i < n; i++) {
    const an = /^\d+$/.test(ac[i]) ? Number(ac[i]) : null
    const bn = /^\d+$/.test(bc[i]) ? Number(bc[i]) : null
    if (an !== null && bn !== null) {
      if (an !== bn) return an - bn
    } else if (ac[i] !== bc[i]) {
      return ac[i] < bc[i] ? -1 : 1
    }
  }
  return ac.length - bc.length
}