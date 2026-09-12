import * as cheerio from 'cheerio'
import { httpFetch } from './http'
import { ehErrorFromResponse } from './catalog-search'

export interface SimpleGallery {
  title: string
  pageUrls: string[]
  coverUrl: string | null
  /** Per-page referer override, e.g. for nhentai CDN (index -> url) */
  sourcePages: (string | null)[]
}

const SKIP_KEYWORDS = ['logo', 'icon', 'avatar', 'sprite', 'banner', '/ads/', 'favicon', 'placeholder']

function resolve(base: string, href: string): string | null {
  try { return new URL(href, base).toString() } catch { return null }
}

function extractNhentaiCover(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html)
  for (const sel of ['#cover img', 'img[alt="Cover"]', '.gallery-cover img', 'img.lazyload']) {
    const el = $(sel).first()
    const src = el.attr('data-src') || el.attr('data-lazy-src') || el.attr('src')
    if (src) return resolve(pageUrl, src)
  }
  return null
}

/** Extracts a balanced {...} JSON object starting right after a marker. */
export function extractBalancedObject(html: string, marker: string): string | null {
  const start = html.indexOf(marker)
  if (start < 0) return null
  let i = html.indexOf('{', start)
  if (i < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  const begin = i
  for (; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return html.slice(begin, i + 1)
    }
  }
  return null
}

/** nhentai-style embedded JSON reader blob. */
export function tryNhentaiReaderPages(html: string): string[] | null {
  const m = html.match(/media_url:\s*'([^']+)'/)
  if (!m) return null
  const mediaUrl = m[1]
  const raw = extractBalancedObject(html, 'gallery:')
  if (!raw) return null
  let mediaId: string | null = null
  try {
    const obj = JSON.parse(raw) as any
    mediaId = obj?.media_id
    const pages: any[] = obj?.images?.pages ?? []
    if (!mediaId || pages.length === 0) return null
    const extFor = (t: string): string => ({ j: 'jpg', p: 'png', w: 'webp', g: 'gif' }[t] ?? 'jpg')
    return pages.map((p, i) => `${mediaUrl}galleries/${mediaId}/${i + 1}.${extFor(p?.t)}`)
  } catch {
    return null
  }
}

/** manga-shi reader container pages. */
function tryMangashiReaderPages(html: string, pageUrl: string): string[] | null {
  const $ = cheerio.load(html)
  const items = $('.reader-pages .reader-page').toArray()
  if (items.length === 0) return null
  const pageNum = (u: string): number => {
    const fn = u.split('/').pop() ?? ''
    const digits = fn.match(/^\d+/)
    return digits ? Number(digits[0]) : 0
  }
  const rows: { order: number | null; url: string }[] = []
  for (const el of items) {
    const $el = $(el)
    const orderStr = $el.attr('data-page-order')
    const img = $el.find('img.reader-image').first()
    const raw = img.attr('data-src') || img.attr('src') || ''
    if (!raw || raw.startsWith('data:')) continue
    const resolved = resolve(pageUrl, raw)
    if (!resolved) continue
    rows.push({ order: orderStr ? Number(orderStr) : null, url: resolved })
  }
  rows.sort((a, b) => {
    if (a.order != null && b.order != null) return a.order - b.order
    if (a.order != null) return -1
    if (b.order != null) return 1
    return pageNum(a.url) - pageNum(b.url)
  })
  return rows.map((r) => r.url)
}

export async function fetchSimpleGallery(
  url: string,
  opts: { proxy?: string; cookieHeader?: string; timeoutMs?: number } = {}
): Promise<SimpleGallery> {
  const r = await httpFetch({
    url,
    headers: {
      Referer: url,
      Accept: 'text/html,application/xhtml+xml',
      ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {})
    },
    timeoutMs: opts.timeoutMs ?? (opts.proxy ? 120_000 : 30_000),
    frontOnEmpty: true
  }, opts.proxy)

  if (r.status >= 400) throw new Error(`HTTP ${r.status}`)
  if (url.includes('exhentai') || url.includes('e-hentai.org')) {
    const ehErr = ehErrorFromResponse(r.status, r.text)
    if (ehErr) throw new Error(ehErr)
  }
  const html = r.text
  const $ = cheerio.load(html)

  const title = $('title').first().text().trim() || 'Gallery'

  let pageUrls: string[] = []
  let coverUrl: string | null = url.includes('nhentai') ? extractNhentaiCover(html, url) : null

  // A0: nhentai embedded JSON reader
  if (pageUrls.length === 0) {
    const p = tryNhentaiReaderPages(html)
    if (p && p.length > 0) pageUrls = p
  }

  // A1: manga-shi reader container
  if (pageUrls.length === 0 && url.includes('manga-shi')) {
    const p = tryMangashiReaderPages(html, url)
    if (p && p.length > 0) pageUrls = p
  }

  // A2: direct content <img> scraping
  if (pageUrls.length === 0) {
    const seen = new Set<string>()
    $('img').each((_i, el) => {
      const $el = $(el)
      const src = ($el.attr('data-src') || $el.attr('data-original') || $el.attr('data-lazy-src') || $el.attr('src') || '').trim()
      if (!src || src.startsWith('data:')) return
      const lower = src.toLowerCase()
      if (SKIP_KEYWORDS.some((k) => lower.includes(k))) return
      const full = resolve(url, src)
      if (!full || seen.has(full)) return
      seen.add(full)
      pageUrls.push(full)
    })
  }

  if (pageUrls.length === 0) {
    throw new Error(
      'Не удалось найти изображения страниц на этой странице. Возможно, это страница ' +
      'описания тайтла, а не сама глава, либо сайт изменил вёрстку и эвристика парсера ' +
      'больше не подходит.'
    )
  }

  // nhentai cover synthesis fallback from first page URL
  if (!coverUrl && url.includes('nhentai')) {
    const first = pageUrls[0]
    if (first.includes('nhentai.net')) {
      const lastSlash = first.lastIndexOf('/')
      if (lastSlash >= 0) {
        const base = first.slice(0, lastSlash + 1)
        coverUrl = base.replace('://i.', '://t.') + 'thumb.webp'
      }
    }
  }

  const sourcePages: (string | null)[] = pageUrls.map(() => null)
  // nhentai reader page URLs for renewing stale signed URLs
  if (url.includes('nhentai')) {
    const parsed = new URL(url)
    const segs = parsed.pathname.split('/').filter(Boolean)
    if (segs[0] === 'g' && segs[1]) {
      const gid = segs[1]
      const base = url.includes('.onion')
        ? (url.split('/g/')[0] ?? '')
        : 'https://nhentai.net'
      pageUrls.forEach((_, i) => {
        if (pageUrls[i].includes('nhentai')) {
          sourcePages[i] = `${base}/g/${gid}/${i + 1}/`
        }
      })
    }
  }

  return { title, pageUrls, coverUrl, sourcePages }
}