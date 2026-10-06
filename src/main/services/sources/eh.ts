import * as cheerio from 'cheerio'
import { httpFetch, httpPostJson } from '../http'
import { ehBlockedMessage } from '../eh-limits-hook'
import { type CatalogItem, resolve, UA, TOR_UA } from './catalog-types'
import { assertLayout } from '../layout-watcher'

export function looksRateLimited(status: number, html: string): boolean {
  if (status === 403 || status === 429) return true
  const lower = html.toLowerCase()
  return ['temporarily banned due to an excessive request rate', 'you have been temporarily banned',
    'your ip address has been banned', 'excessive request rate'].some((m) => lower.includes(m))
}

/** Maps E-Hentai/ExHentai responses to user-friendly errors (same checks as JHenTai). */
export function ehErrorFromResponse(status: number, text: string): string | null {
  const blockedMsg = ehBlockedMessage()
  if (blockedMsg) return blockedMsg
  if (status === 403) return 'Cloudflare блокирует запрос (403). Попробуй другой IP/VPN или подожди.'
  if (status === 429) return 'Слишком много запросов (429). Подожди минуту-другую.'
  if (!text || text.trim().length === 0) {
    return 'Сервер ответил пустым телом — похоже, IP забанен на ExHentai (sad panda) или запрос блокируется анти-ботом.'
  }
  if (text.startsWith('Your IP address') || text.startsWith('This IP address')) {
    const first = text.split('\n')[0].trim()
    return `IP забанен: ${first}`
  }
  if (text.startsWith('You have exceeded your image')) {
    return 'Превышен лимит просмотра изображений на E-Hentai. Подожди до сброса лимита.'
  }
  if (text.includes('Page load has been aborted due to a fatal error')) {
    return 'Внутренняя ошибка сервера E-Hentai. Попробуй ещё раз позже.'
  }
  return null
}

export interface ExSearchResult extends CatalogItem {
  category: string | null
  rating: number | null
  chapterTotal: number | null
  thumbUrl: string | null
}

/** Parses an E-Hentai/ExHentai listing page. Handles both the compact
 * listing (`.itg.gltc > tbody > tr`, JHenTai-style) and the thumbnail mode
 * (`.itg.gld > div`) that e-hentai serves with `inline_set=dm_t`. */
export function parseExHentaiListing(html: string, base: string): ExSearchResult[] {
  assertLayout(['itg', 'glink', '/g/'], html, 'E-Hentai list')
  const $ = cheerio.load(html)
  const results: ExSearchResult[] = []
  const seen = new Set<string>()

  const push = (item: ExSearchResult): void => {
    if (seen.has(item.url)) return
    seen.add(item.url)
    results.push(item)
  }

  const parseCover = ($el: cheerio.Cheerio<any>): string | null => {
    const img = $el.find('img').first()
    const cover = img.attr('data-src') || img.attr('src') || null
    return cover ? resolve(base, cover) : null
  }

  // Compact rows: `.itg.gltc > tbody > tr`, each with `.gl3c.glname > a`,
  // `.glink` (title), `.cn` (category) and `.gl4c.glhide > div` (pages).
  $('table.itg tr').each((_i, el) => {
    const $el = $(el)
    const a = $el.find('.gl3c.glname a, td.glname a').first()
    const href = a.attr('href') ?? ''
    if (!href.includes('/g/')) return
    const full = resolve(base, href)
    if (!full) return
    const title = $el.find('.glink').first().text().trim() || a.text().trim() || (a.attr('title') ?? '')
    const pageDivs = $el.find('.gl4c.glhide > div')
    const pagesText = pageDivs.length >= 2 ? pageDivs.eq(1).text() : $el.text()
    const pagesM = pagesText.match(/(\d+)\s+(?:pages?|страниц)/i)
    const rowText = $el.text()
    const ratingM = rowText.match(/(\d(?:\.\d+)?)\s*\/\s*5/)
    push({
      url: full, title,
      coverUrl: parseCover($el),
      thumbUrl: null,
      category: $el.find('.cn').first().text().trim() || $el.find('td.glcat').first().text().trim() || null,
      rating: ratingM ? Number(ratingM[1]) : null,
      pages: pagesM ? Number(pagesM[1]) : null, chapterTotal: null
    })
  })

  // Thumbnail mode: `.itg.gld > div` — each block has a `/g/` link,
  // `.glink` (title), `.cs` (category), cover and page count in `.gl5t`.
  if (results.length === 0) {
    $('.itg.gld > div').each((_i, el) => {
      const $el = $(el)
      const a = $el.find('a[href*="/g/"]').first()
      const href = a.attr('href') ?? ''
      if (!href.includes('/g/')) return
      const full = resolve(base, href)
      if (!full) return
      const title = $el.find('.glink').first().text().trim() || $el.find('.gl1t').first().text().trim() || a.text().trim() || ''
      const pagesM = $el.text().match(/(\d+)\s+(?:pages?|страниц)/i)
      const rowText = $el.text()
      const ratingM = rowText.match(/(\d(?:\.\d+)?)\s*\/\s*5/)
      push({
        url: full, title,
        coverUrl: parseCover($el),
        thumbUrl: null,
        category: $el.find('.cs').first().text().trim() || null,
        rating: ratingM ? Number(ratingM[1]) : null,
        pages: pagesM ? Number(pagesM[1]) : null, chapterTotal: null
      })
    })
  }

  return results
}

export function extractGid(url: string): string | null {
  const m = url.match(/\/g\/(\d+)\//)
  return m ? m[1] : null
}

export function extractGidToken(url: string): { gid: string; token: string } | null {
  const m = url.match(/\/g\/(\d+)\/([0-9a-f]+)\/?/)
  return m ? { gid: m[1], token: m[2] } : null
}

export interface GDataResult {
  gid: string
  token: string
  title: string
  title_jpn?: string
  category: string
  thumb?: string
  uploader: string
  posted: string
  filecount: string
  filesize: number
  expunged: boolean
  rating: string
  tags: string[]
  comment_count: number
}

/**
 * E-Hentai/ExHentai JSON metadata API (same as JHenTai's requestGalleryMetadatas):
 * POST api.php with `{ method: 'gdata', gidlist: [[gid, token], ...], namespace: 1 }`.
 * Batching is capped at 25 per request.
 */
export async function fetchGData(
  list: { gid: string; token: string }[],
  opts: { apiBase?: string; cookieHeader?: string; proxy?: string; timeoutMs?: number } = {}
): Promise<GDataResult[]> {
  if (list.length === 0) return []
  const apiBase = opts.apiBase ?? 'https://exhentai.org/api.php'
  const out: GDataResult[] = []
  for (let i = 0; i < list.length; i += 25) {
    const batch = list.slice(i, i + 25)
    const json = await httpPostJson(
      apiBase,
      JSON.stringify({ method: 'gdata', gidlist: batch.map((b) => [b.gid, b.token]), namespace: 1 }),
      { 'Content-Type': 'application/json', ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {}) },
      opts.proxy,
      opts.timeoutMs ?? 20_000
    ) as any
    const arr: any[] = json?.gmetadata ?? []
    for (const m of arr) {
      out.push({
        gid: String(m?.gid ?? ''),
        token: String(m?.token ?? ''),
        title: m?.title ?? '',
        title_jpn: m?.title_jpn,
        category: m?.category ?? '',
        thumb: m?.thumb,
        uploader: m?.uploader ?? '',
        posted: m?.posted ?? '',
        filecount: String(m?.filecount ?? ''),
        filesize: m?.filesize ?? 0,
        expunged: !!m?.expunged,
        rating: m?.rating ?? '',
        tags: Array.isArray(m?.tags) ? m.tags : [],
        comment_count: m?.comment_count ?? 0
      })
    }
  }
  return out
}

export function buildEhSearchParams(opts: {
  query: string
  excludedCats?: number
  minRating?: number
  inlineSet?: boolean
  cursor?: { dir: 'next' | 'prev'; gid: string }
}): string[] {
  const params: string[] = []
  if (opts.query.trim()) params.push(`f_search=${encodeURIComponent(opts.query)}`)
  const cats = opts.excludedCats ?? 0
  if (cats > 0) params.push(`f_cats=${cats}`)
  if (opts.minRating && opts.minRating > 0) params.push(`f_srdd=${opts.minRating}`)
  if (opts.inlineSet) params.push('inline_set=dm_t')
  if (opts.cursor) params.push(`${opts.cursor.dir}=${opts.cursor.gid}`)
  return params
}

export async function searchExHentai(
  query: string,
  opts: {
    cookieHeader: string
    torSocksAddr: string
    proxyAddr?: string
    useOnion: boolean
    page?: number
    forceTor?: boolean
    excludedCats?: number
    minRating?: number
    domainOverride?: string
    cursor?: { dir: 'next' | 'prev'; gid: string }
  },
  exProxy?: string
): Promise<ExSearchResult[]> {
  const useProxy = opts.useOnion || opts.forceTor
  const proxy = exProxy ?? (useProxy ? opts.torSocksAddr : undefined)
  const ua = useProxy ? TOR_UA : UA
  const base = opts.domainOverride
    ? opts.domainOverride
    : opts.useOnion
      ? 'http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion'
      : 'https://exhentai.org'

  const params = buildEhSearchParams({
    query, excludedCats: opts.excludedCats ?? 0, minRating: opts.minRating,
    inlineSet: !!opts.domainOverride, cursor: opts.cursor
  })
  const url = params.length ? `${base}/?${params.join('&')}` : `${base}/`

  return await ehFetchListing(url, base, {
    cookieHeader: opts.cookieHeader, proxy, ua,
    gdataApiBase: opts.domainOverride ? 'https://api.e-hentai.org/api.php' : 'https://exhentai.org/api.php'
  })
}

async function ehFetchListing(
  url: string, base: string,
  o: { cookieHeader: string; proxy?: string; ua: string; gdataApiBase: string }
): Promise<ExSearchResult[]> {
  const r = await httpFetch({
    url,
    headers: {
      'User-Agent': o.ua, Referer: `${base}/`, Accept: 'text/html,application/xhtml+xml',
      ...(o.cookieHeader ? { Cookie: o.cookieHeader } : {})
    },
    timeoutMs: o.proxy ? 120_000 : 30_000,
    frontOnEmpty: true
  }, o.proxy)

  if (looksRateLimited(r.status, r.text)) throw new Error('Сайт временно заблокировал IP за слишком частые запросы (excessive request rate). Подожди минуту-другую и попробуй снова.')
  const ehErr = ehErrorFromResponse(r.status, r.text)
  if (ehErr) throw new Error(`ExHentai: ${ehErr}`)
  if (r.status >= 400) throw new Error(`ExHentai: HTTP ${r.status}`)

  const results = parseExHentaiListing(r.text, base)
  if (results.length === 0) {
    const lower = r.text.toLowerCase()
    if (lower.includes('sad panda') || lower.includes('sorry, your ip') || lower.includes('ip has been banned')) {
      throw new Error('ExHentai: sad panda — аккаунт/IP без доступа к ExHentai или вход не выполнен')
    }
    if (!r.text.includes('table') && r.text.length < 4000) throw new Error('ExHentai: страница пуста или требует входа (sad panda / логин)')
    throw new Error('ExHentai: ничего не найдено (или куки не действительны / сайт изменил вёрстку)')
  }
  try {
    const meta = await fetchGData(
      results.map((x) => extractGidToken(x.url)).filter((x): x is { gid: string; token: string } => !!x),
      { apiBase: o.gdataApiBase, cookieHeader: o.cookieHeader, proxy: o.proxy, timeoutMs: o.proxy ? 120_000 : 20_000 }
    )
    const byGid = new Map(meta.map((m) => [m.gid, m]))
    for (const x of results) {
      const gid = extractGid(x.url); const m = gid ? byGid.get(gid) : undefined
      if (!m) continue
      if (m.category) x.category = m.category
      const rc = Number(m.rating); if (!isNaN(rc) && rc > 0) x.rating = rc
      const fc = Number(m.filecount); if (!isNaN(fc) && fc > 0) x.pages = fc
    }
  } catch { /* best-effort */ }
  return results
}

export async function fetchEhPopular(
  source: 'ehentai' | 'exhentai' | 'exhentai_onion',
  opts: { cookieHeader: string; torSocksAddr: string; exProxyAddr?: string; torProxied: boolean }
): Promise<ExSearchResult[]> {
  const useOnion = source === 'exhentai_onion'
  const base = useOnion
    ? 'http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion'
    : source === 'ehentai' ? 'https://e-hentai.org' : 'https://exhentai.org'
  const useProxy = useOnion || opts.torProxied
  const proxy = useProxy ? opts.torSocksAddr : (opts.exProxyAddr?.trim() || undefined)
  const ua = useProxy ? TOR_UA : UA
  return await ehFetchListing(`${base}/popular`, base, {
    cookieHeader: opts.cookieHeader, proxy, ua,
    gdataApiBase: source === 'ehentai' ? 'https://api.e-hentai.org/api.php' : 'https://exhentai.org/api.php'
  })
}
