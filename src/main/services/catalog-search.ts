import * as cheerio from 'cheerio'
import { httpFetch, httpGetJson, httpPostJson } from './http'
import type { CookieJar } from './cookies'
import type { ChapterInfo } from './sources'

export interface CatalogItem {
  url: string
  title: string
  coverUrl: string | null
  pages: number | null
}

export type CatalogSourceKey =
  | 'mangadex' | 'exhentai' | 'exhentai_onion' | 'ehentai' | 'nhentai'
  | 'nhentai_onion' | 'comx' | 'senkuro' | 'mangashi' | 'remanga' | 'mangalib'

export interface CatalogFilters {
  ehExcludedCats?: number
  mangashiSort?: string
  mangashiStatus?: string
  mangashiType?: string
  mangashiYear?: string
  mangashiAgeRating?: string
  mangashiChaptersMin?: string
  mangashiChaptersMax?: string
  mangashiTags?: string[]
  remangaOrdering?: string
  remangaStatus?: string
  remangaTypes?: string
  remangaGenres?: string[]
  remangaCategories?: string[]
}

export interface SimpleSiteConfig {
  name: string
  base: string
  catalogPath: string
  searchPath: string
  linkMarker: string
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const TOR_UA = 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0'

export function siteKeyForUrl(url: string): string | null {
  const l = url.toLowerCase()
  if (l.includes('nhentai')) return 'nhentai'
  if (l.includes('e-hentai.org')) return 'ehentai'
  if (l.includes('com-x.life')) return 'comx'
  if (l.includes('senkuro.')) return 'senkuro'
  if (l.includes('manga-shi.')) return 'mangashi'
  if (l.includes('remanga.')) return 'remanga'
  if (l.includes('mangalib.')) return 'mangalib'
  return null
}

function resolve(base: string, href: string): string | null {
  try { return new URL(href, base).toString() } catch { return null }
}

function extractCoverFromSubtree($: cheerio.CheerioAPI, el: any): string | null {
  for (const attr of ['data-src', 'data-original', 'src']) {
    const v = $(el).find(`img[${attr}]`).first().attr(attr)
    if (v && !v.startsWith('data:')) return v
  }
  const bg = $(el).find('*').map((_i, e) => {
    const style = $(e).attr('style') ?? ''
    const m = style.match(/url\(['"]?([^)'"]+)['"]?\)/)
    return m ? m[1] : null
  }).get().find((x): x is string => !!x)
  return bg ?? null
}

export async function searchSimpleSite(
  config: SimpleSiteConfig,
  query: string,
  extraQuery = '',
  opts: { proxy?: string; overridePath?: string } = {}
): Promise<CatalogItem[]> {
  let target = opts.overridePath
    ? `${config.base}${opts.overridePath}`
    : query
      ? `${config.base}${config.searchPath}${encodeURIComponent(query)}`
      : `${config.base}${config.catalogPath}`
  if (extraQuery) target += (target.includes('?') ? '&' : '?') + extraQuery

  const r = await httpFetch({
    url: target,
    headers: { Referer: `${config.base}/`, Accept: 'text/html,application/xhtml+xml' }
  }, opts.proxy)
  if (r.status >= 400) throw new Error(`${config.name}: HTTP ${r.status}`)

  const $ = cheerio.load(r.text)
  const results: CatalogItem[] = []
  const seen = new Set<string>()
  $('a').each((_i, el) => {
    const href = $(el).attr('href') ?? ''
    if (!href.includes(config.linkMarker)) return
    const full = resolve(target, href)
    if (!full || seen.has(full)) return
    seen.add(full)

    let title = $(el).text().trim()
    if (!title) title = $(el).find('img').first().attr('alt') || $(el).find('img').first().attr('title') || ''
    if (!title) title = $(el).attr('title') ?? ''
    if (title.length < 2) return

    let cover = extractCoverFromSubtree($, el)
    const parent = $(el).parent()
    if (!cover) cover = extractCoverFromSubtree($, parent.get(0) as any)
    const coverUrl = cover ? resolve(target, cover) : null

    const allText = `${title} ${parent.text()}`
    const m = allText.match(/(\d+)\s+(?:page|pages|стр|стр\.)/i)
    results.push({ url: full, title, coverUrl, pages: m ? Number(m[1]) : null })
  })

  if (results.length === 0) {
    throw new Error(`${config.name}: ничего не найдено (или сайт изменил вёрстку и парсер не смог найти ссылки)`)
  }
  return results
}

// ── ExHentai / E-Hentai ────────────────────────────────────────────────

function looksRateLimited(status: number, html: string): boolean {
  if (status === 403 || status === 429) return true
  const lower = html.toLowerCase()
  return ['temporarily banned due to an excessive request rate', 'you have been temporarily banned',
    'your ip address has been banned', 'excessive request rate'].some((m) => lower.includes(m))
}

export interface ExSearchResult extends CatalogItem {
  category: string | null
  rating: number | null
  chapterTotal: number | null
  thumbUrl: string | null
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
  },
  exProxy?: string
): Promise<ExSearchResult[]> {
  const useProxy = opts.useOnion || opts.forceTor
  const proxy = exProxy ?? (useProxy ? opts.torSocksAddr : undefined)
  const ua = useProxy ? TOR_UA : UA
  const base = opts.useOnion
    ? 'http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion'
    : 'https://exhentai.org'

  const cats = opts.excludedCats ?? 0
  const catsParam = cats > 0 ? `&f_cats=${cats}` : ''

  let url: string
  if (opts.useOnion) {
    url = `${base}/?f_search=${encodeURIComponent(query)}&page=${opts.page ?? 0}${catsParam}`
  } else {
    url = `${base}/?f_search=${encodeURIComponent(query)}&page=${opts.page ?? 0}${catsParam}`
  }

  const r = await httpFetch({
    url,
    headers: {
      'User-Agent': ua,
      Referer: `${base}/`,
      Accept: 'text/html,application/xhtml+xml',
      ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {})
    }
  }, proxy)

  if (looksRateLimited(r.status, r.text)) {
    throw new Error('Сайт временно заблокировал IP за слишком частые запросы (excessive request rate). Подожди минуту-другую и попробуй снова.')
  }
  if (r.status >= 400) throw new Error(`ExHentai: HTTP ${r.status}`)

  const $ = cheerio.load(r.text)
  const results: ExSearchResult[] = []
  $('table.itg tr.gtr0, table.itg tr.gtr1').each((_i, el) => {
    const a = $(el).find('td.glname a').first()
    const href = a.attr('href') ?? ''
    if (!href.includes('/g/')) return
    const full = resolve(base, href)
    if (!full) return
    const title = a.text().trim() || (a.attr('title') ?? '')
    const cover = $(el).find('img').first().attr('data-src') || $(el).find('img').first().attr('src') || null
    const coverUrl = cover ? resolve(base, cover) : null
    const rowText = $(el).text()
    const pagesM = rowText.match(/(\d+)\s+(?:pages?|страниц)/i)
    const ratingM = rowText.match(/(\d(?:\.\d+)?)\s*\/\s*5/)
    results.push({
      url: full, title, coverUrl,
      thumbUrl: coverUrl,
      category: null, rating: ratingM ? Number(ratingM[1]) : null,
      pages: pagesM ? Number(pagesM[1]) : null, chapterTotal: null
    })
  })

  if (results.length === 0) {
    throw new Error('ExHentai: ничего не найдено (или куки не действительны / сайт изменил вёрстку)')
  }
  return results
}

// ── Remanga ────────────────────────────────────────────────────────────

export async function searchRemanga(
  query: string,
  page: number,
  filters: CatalogFilters = {}
): Promise<CatalogItem[]> {
  const params = new URLSearchParams({
    query, page: String(page + 1), count: '20', ordering: 'index'
  })
  if (filters.remangaOrdering) params.set('ordering', filters.remangaOrdering)
  if (filters.remangaStatus) params.set('status', filters.remangaStatus)
  if (filters.remangaTypes) params.set('types', filters.remangaTypes)
  for (const g of filters.remangaGenres ?? []) params.append('genres', g)
  for (const c of filters.remangaCategories ?? []) params.append('categories', c)
  const json = await httpGetJson(
    `https://api.remanga.org/api/v2/search/catalog/?${params.toString()}`,
    { Referer: 'https://remanga.org/', Accept: 'application/json' }
  ) as any
  const results: any[] = json?.results ?? json?.content ?? []
  return results.map((r) => ({
    url: `https://remanga.org/manga/${r?.dir ?? ''}/`,
    title: r?.main_name ?? r?.rus_name ?? r?.name ?? 'Без названия',
    coverUrl: r?.cover?.high ?? r?.cover?.mid ?? null,
    pages: r?.count_chapters ?? null,
    score: typeof r?.avg_rating === 'number' ? r.avg_rating : null
  }))
}

// ── Senkuro ────────────────────────────────────────────────────────────

export async function searchSenkuro(query: string, cookieHeader = ''): Promise<CatalogItem[]> {
  const gql = JSON.stringify({ query: `query { searchManga(query: "${query}") { edges { node { id slug titles { lang content } cover { original { url } } } } } }` })
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'App-Id': '1006632962658', 'App-Version': '240626',
    Origin: 'https://senkuro.me', Accept: 'application/json'
  }
  if (cookieHeader) {
    headers.Cookie = cookieHeader
    const token = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith('access_token='))?.slice('access_token='.length)
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const json = await httpPostJson('https://api.senkuro.org/graphql', gql, headers) as any
  const edges: any[] = json?.data?.searchManga?.edges ?? []
  const items = edges.map((e) => {
    const n = e?.node ?? {}
    const title = n?.titles?.find((t: any) => t?.lang === 'RU')?.content
      ?? n?.titles?.[0]?.content ?? 'Без названия'
    return {
      url: `https://senkuro.me/manga/${n?.slug ?? ''}/`,
      title,
      coverUrl: n?.cover?.original?.url ?? null,
      pages: null
    }
  })
  if (items.length === 0) throw new Error('Senkuro: ничего не найдено')
  return items
}

// ── Manga-shi ──────────────────────────────────────────────────────────

export async function searchMangaShi(
  query: string,
  proxy?: string,
  filters: CatalogFilters = {}
): Promise<CatalogItem[]> {
  const base = 'https://manga-shi.org'
  const params: string[] = []
  if (query.trim()) params.push(`q=${encodeURIComponent(query.trim())}`)
  if (filters.mangashiSort) params.push(`sort=${filters.mangashiSort}`)
  if (filters.mangashiStatus) params.push(`status=${filters.mangashiStatus}`)
  if (filters.mangashiType) params.push(`type=${filters.mangashiType}`)
  if (filters.mangashiYear) params.push(`year=${filters.mangashiYear}`)
  if (filters.mangashiAgeRating) params.push(`age_rating=${filters.mangashiAgeRating}`)
  if (filters.mangashiChaptersMin) params.push(`chapters_min=${filters.mangashiChaptersMin}`)
  if (filters.mangashiChaptersMax) params.push(`chapters_max=${filters.mangashiChaptersMax}`)
  for (const t of filters.mangashiTags ?? []) params.push(`tag=${t}`)
  const url = `${base}/catalog/${params.length ? `?${params.join('&')}` : ''}`
  const r = await httpFetch({ url, headers: { Referer: `${base}/`, Accept: 'text/html' } }, proxy)
  if (r.status >= 400) throw new Error(`Manga-shi: HTTP ${r.status}`)
  const $ = cheerio.load(r.text)
  const results: CatalogItem[] = []
  const seen = new Set<string>()
  $('a.media-shell').each((_i, el) => {
    const href = $(el).attr('href') ?? ''
    if (!href.includes('/manga/')) return
    const full = resolve(base, href)
    if (!full || seen.has(full)) return
    seen.add(full)
    const title = $(el).find('h3').first().text().trim() || $(el).attr('title') || ''
    const img = $(el).find('img').first()
    const cover = img.attr('data-src') || img.attr('src') || null
    results.push({
      url: full, title,
      coverUrl: cover ? resolve(base, cover) : null,
      pages: null
    })
  })
  if (results.length === 0) throw new Error('Manga-shi: ничего не найдено')
  return results
}

// ── Manga-shi chapters ─────────────────────────────────────────────────

function findNextPage(html: string): number | null {
  const re = /page=(\d+)/g
  let m: RegExpExecArray | null
  let best: number | null = null
  while ((m = re.exec(html)) !== null) {
    const n = Number(m[1])
    if (n > 1 && (best === null || n > best)) best = n
  }
  return best
}

function mangashiChapterNumFromUrl(full: string, text: string): string {
  try {
    const u = new URL(full)
    const seg = u.pathname.split('/').filter(Boolean).find((s) => s.startsWith('glava-'))
    if (seg) return `Глава ${seg.slice('glava-'.length)}`
  } catch { /* ignore */ }
  const lower = text.toLowerCase()
  const pos = lower.indexOf('глава')
  if (pos >= 0) {
    const rest = text.slice(pos + 'глава'.length).trimStart()
    const m = rest.match(/^[\d.]+/)
    if (m) return `Глава ${m[0]}`
  }
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  return firstLine && firstLine.length > 0 ? firstLine : 'Глава'
}

export async function fetchMangaShiChapters(mangaUrl: string, proxy?: string): Promise<ChapterInfo[]> {
  const base = mangaUrl.trim().replace(/\/+$/, '')
  const opts = { headers: { Referer: mangaUrl, Accept: 'text/html,application/xhtml+xml' }, timeoutMs: 30_000 }

  const page1 = await httpFetch({ url: mangaUrl, ...opts }, proxy)
  if (page1.status >= 400) throw new Error(`Manga-shi: HTTP ${page1.status}`)

  const allChapters: ChapterInfo[] = []
  const seen = new Set<string>()

  const parseChapters = (html: string): void => {
    const $ = cheerio.load(html)
    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href') ?? ''
      if (!href.includes('/glava-')) return
      const full = resolve(base, href)
      if (!full || seen.has(full)) return
      seen.add(full)
      const text = $(el).text()
      allChapters.push({
        chapter_id: full,
        chapter_num: mangashiChapterNumFromUrl(full, text),
        title: null,
        lang: 'mangashi'
      })
    })
  }

  parseChapters(page1.text)

  let page = findNextPage(page1.text)
  while (page != null && page <= 200) {
    const target = `${base}/chapters/?chapter_sort=latest&page=${page}`
    const r = await httpFetch({ url: target, ...opts }, proxy)
    if (r.status >= 400) break
    parseChapters(r.text)
    const next = findNextPage(r.text)
    if (next == null || next <= page) break
    page = next
  }

  if (!allChapters.some((ch) => ch.chapter_num === 'Глава 1')) {
    const ch1 = allChapters.find((ch) => ch.chapter_num === 'Читать сначала')
    allChapters.push({
      chapter_id: ch1?.chapter_id ?? `${base}/glava-1/`,
      chapter_num: 'Глава 1',
      title: null,
      lang: 'mangashi'
    })
  }

  const sortKey = (id: string): number => {
    const m = id.trim().replace(/\/+$/, '').split('/').pop()?.match(/^glava-(\d+)/)
    return m ? Number(m[1]) : 0
  }
  allChapters.sort((a, b) => sortKey(a.chapter_id) - sortKey(b.chapter_id))

  if (allChapters.length === 0) {
    throw new Error('На этой странице не нашлось ни одной главы — возможно, тайтл ещё не начали переводить, либо сайт изменил вёрстку.')
  }
  return allChapters
}

// ── nhentai simple (catalog) ───────────────────────────────────────────

function parseNhentaiPageCount(html: string): number | null {
  const words = html.replace(/<[^>]+>/g, ' ').replace(/[^\w:. ]/g, ' ').split(/\s+/)
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i]
    const n = Number(w)
    const next = words[i + 1].toLowerCase()
    if (Number.isInteger(n) && (next === 'pages' || next === 'page')) return n
  }
  const m = html.match(/pages?\s*[:]\s*(\d+)/i) || html.match(/[^a-z](\d+)\s+pages?/i)
  return m ? Number(m[1]) : null
}

export async function searchNhentai(
  base: string,
  query: string,
  page: number,
  opts: { proxy?: string; cookieHeader?: string; showPageCounts?: boolean } = {}
): Promise<CatalogItem[]> {
  const url = `${base}/search/?q=${encodeURIComponent(query)}&page=${page + 1}`
  const r = await httpFetch({
    url,
    headers: { Referer: `${base}/`, Accept: 'text/html' }
  }, opts.proxy)
  if (r.status >= 400) throw new Error(`NHentai: HTTP ${r.status}`)
  const $ = cheerio.load(r.text)
  const results: CatalogItem[] = []
  const seen = new Set<string>()
  $('a.cover').each((_i, el) => {
    const href = $(el).attr('href') ?? ''
    if (!href.includes('/g/')) return
    const full = resolve(base, href)
    if (!full || seen.has(full)) return
    seen.add(full)
    const title = $(el).attr('title') || $(el).find('img').first().attr('title') || ''
    const img = $(el).find('img').first()
    const cover = img.attr('data-src') || img.attr('src') || null
    results.push({ url: full, title, coverUrl: cover ? resolve(base, cover) : null, pages: null })
  })
  if (results.length === 0) throw new Error('NHentai: ничего не найдено')

  if (opts.showPageCounts) {
    const maxConcurrent = base.includes('.onion') ? 2 : 4
    const queue = [...results]
    let next = 0
    async function worker(): Promise<void> {
      while (next < queue.length) {
        const idx = next++
        const item = queue[idx]
        try {
          const pr = await httpFetch({
            url: item.url,
            headers: { Referer: `${base}/`, Accept: 'text/html' },
            timeoutMs: 20_000
          }, opts.proxy)
          const pages = pr.status < 400 ? parseNhentaiPageCount(pr.text) : null
          if (pages != null) item.pages = pages
        } catch { /* ignore */ }
      }
    }
    await Promise.all(Array.from({ length: maxConcurrent }, () => worker()))
  }
  return results
}

export type { CookieJar }
