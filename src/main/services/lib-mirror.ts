// Only img33 is still served by the Lib image CDN (img34/img45 removed from
// DNS server-side — verified with system + ComssDNS resolvers on 2026-09-13).
export const LIB_MIRRORS = ['img33.imgslib.link']
let chosen: string | null = null

export function setLibMirror(v: string | null): void {
  chosen = v && v.trim() ? v.trim() : null
}

export function libMirror(): string | null {
  return chosen
}

export function rewriteImglibHost(url: string, chosen: string | null): string {
  if (!chosen) return url
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('.imgslib.link') && u.hostname !== chosen) {
      u.hostname = chosen
      return u.toString()
    }
    return url
  } catch {
    return url
  }
}

export function withMirror(url: string): string {
  return rewriteImglibHost(url, libMirror())
}
