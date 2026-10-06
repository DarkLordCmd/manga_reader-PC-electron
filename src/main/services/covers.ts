import type { Settings } from '@shared/settings'
import { httpFetchBinary } from './http'
import { withMirror } from './lib-mirror'

function siteKeyForUrl(url: string): string | null {
  const l = url.toLowerCase()
  if (l.includes('mangadex') || l.includes('uploads.mangadex.org')) return 'mangadex'
  if (l.includes('ehgt.org')) return 'ehgt'
  if (l.includes('exhentai')) return 'exhentai'
  if (l.includes('e-hentai.org')) return 'ehentai'
  if (l.includes('nhentai')) return 'nhentai'
  if (l.includes('senkuro')) return 'senkuro'
  if (l.includes('remanga')) return 'remanga'
  if (l.includes('manga-shi')) return 'mangashi'
  if (l.includes('mangalib') || l.includes('cdnlibs.org') || l.includes('imglib.info') || l.includes('imgslib.link')) return 'mangalib'
  if (l.includes('com-x.life')) return 'comx'
  // Grouple cover CDNs live on separate hosts (e.g. mmm/resrmr.one-way.work).
  if (l.includes('one-way.work') || l.includes('readmanga') || l.includes('mintmanga') || l.includes('mangapoisk')) return 'grouple'
  return null
}

export function coverReferer(siteKey: string | null, url: string): string | undefined {
  switch (siteKey) {
    case 'mangadex': return 'https://mangadex.org/'
    case 'ehgt': return url.toLowerCase().includes('e-hentai') ? 'https://e-hentai.org/' : 'https://exhentai.org/'
    case 'exhentai': return 'https://exhentai.org/'
    case 'ehentai': return 'https://e-hentai.org/'
    case 'senkuro': return 'https://senkuro.me/'
    case 'remanga': return 'https://remanga.org/'
    case 'mangashi': return 'https://manga-shi.org/'
    case 'mangalib': return 'https://mangalib.me/'
    case 'comx': return 'https://com-x.life/'
    case 'grouple':
      // one-way.work CDN hot-link check passes with the grouple-site Referer
      // (verified live: 402 without, 200 with).
      return 'https://mintmanga.com/'
    case 'nhentai': return url.includes('.onion') ? url : 'https://nhentai.net/'
    default: return undefined
  }
}

function coverProxy(siteKey: string | null, url: string, s: Settings): string | undefined {
  const tor = s.tor_socks_addr || '127.0.0.1:9150'
  const site = siteKey === 'ehgt' ? 'ehentai' : siteKey
  if (url.includes('.onion')) return tor
  // Grouple CDN hosts (one-way.work etc.) are SNI/TCP-blocked like the sites.
  if (site === 'grouple') return tor
  if (site && s.tor_proxied_sites.includes(site)) return tor
  if ((site === 'exhentai' || site === 'ehentai') && s.exhentai_proxy_addr.trim()) return s.exhentai_proxy_addr.trim()
  return undefined
}

function coverCookie(siteKey: string | null, url: string, s: Settings, accountCookieHeader: string): string | undefined {
  if (siteKey === 'ehgt' || siteKey === 'exhentai' || siteKey === 'ehentai') {
    // Clearnet ExHentai/E-Hentai: the active account pool cookies.
    if (url.includes('.onion')) return s.onion_cookies_raw || undefined
    return accountCookieHeader || undefined
  }
  if (siteKey === 'nhentai') return url.includes('.onion') ? (s.nhentai_onion_cookies_raw || undefined) : (s.nhentai_cookies_raw || undefined)
  return undefined
}

export async function fetchCoverBuffer(
  url: string,
  s: Settings,
  accountCookieHeader: string
): Promise<Buffer> {
  const siteKey = siteKeyForUrl(url)
  url = withMirror(url)
  const headers: Record<string, string> = {}
  const referer = coverReferer(siteKey, url)
  if (referer) headers.Referer = referer
  const cookie = coverCookie(siteKey, url, s, accountCookieHeader)
  if (cookie) headers.Cookie = cookie

  const proxy = coverProxy(siteKey, url, s)
  // Clearnet nhentai is routinely DNS-poisoned/rejected in RU — allow the
  // custom-DNS→Tor fallback chain on its HTTP failures.
  const allowHttpFallback = siteKey === 'nhentai' && !url.includes('.onion')
  try {
    const bytes = await httpFetchBinary(url, headers, proxy, proxy ? 90_000 : 30_000, allowHttpFallback)
    return Buffer.from(bytes)
  } catch (e) {
    // nhentai thumbnail fallback: the HTML-reported cover (e.g. cover.webp)
    // may be blocked/missing — try classic thumb.webp / thumb.jpg on the same path.
    if (siteKey === 'nhentai') {
      const alts: string[] = []
      if (url.includes('/cover.')) alts.push(url.replace(/\/cover\.(\w+)/, '/thumb.$1'))
      for (const alt of alts) {
        try {
          const bytes = await httpFetchBinary(alt, headers, proxy, proxy ? 90_000 : 30_000, allowHttpFallback)
          return Buffer.from(bytes)
        } catch { /* next */ }
      }
    }
    throw e
  }
}