import * as cheerio from 'cheerio'
import { httpFetch, httpGetJson, httpPostJson } from './http'
import type { CookieJar } from './cookies'
import type { ChapterInfo } from './sources'

export interface CatalogItem {
  url: string
  title: string
  coverUrl: string | null
  pages: number | null
  kind?: string | null
  score?: number | null
  chapterCount?: number | null
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

/** Maps E-Hentai/ExHentai responses to user-friendly errors (same checks as JHenTai). */
export function ehErrorFromResponse(status: number, text: string): string | null {
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

  const params: string[] = []
  if (query.trim()) params.push(`f_search=${encodeURIComponent(query)}`)
  const cats = opts.excludedCats ?? 0
  if (cats > 0) params.push(`f_cats=${cats}`)
  // E-Hentai is fetched without a login cookie, so the site defaults to a
  // plain text listing the parser can't read — force thumbnail display mode.
  if (opts.domainOverride) params.push('inline_set=dm_t')
  if (opts.cursor) params.push(`${opts.cursor.dir}=${opts.cursor.gid}`)
  const url = params.length ? `${base}/?${params.join('&')}` : `${base}/`

  const r = await httpFetch({
    url,
    headers: {
      'User-Agent': ua,
      Referer: `${base}/`,
      Accept: 'text/html,application/xhtml+xml',
      ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {})
    },
    // Tor (especially via bridges) is slow — give proxied requests plenty of time.
    timeoutMs: proxy ? 120_000 : 30_000,
    // An empty body (sad panda / IP rate-limit on the direct path) retries
    // once through domain fronting, which uses a different egress IP.
    frontOnEmpty: true
  }, proxy)

  if (looksRateLimited(r.status, r.text)) {
    throw new Error('Сайт временно заблокировал IP за слишком частые запросы (excessive request rate). Подожди минуту-другую и попробуй снова.')
  }
  const ehErr = ehErrorFromResponse(r.status, r.text)
  if (ehErr) throw new Error(`ExHentai: ${ehErr}`)
  if (r.status >= 400) throw new Error(`ExHentai: HTTP ${r.status}`)

  const results = parseExHentaiListing(r.text, base)

  if (results.length === 0) {
    // Sad panda / banned account pages are short and contain no galleries.
    const lower = r.text.toLowerCase()
    if (lower.includes('sad panda') || lower.includes('sorry, your ip') || lower.includes('ip has been banned')) {
      throw new Error('ExHentai: sad panda — аккаунт/IP без доступа к ExHentai или вход не выполнен')
    }
    if (!r.text.includes('table') && r.text.length < 4000) {
      throw new Error('ExHentai: страница пуста или требует входа (sad panda / логин)')
    }
    throw new Error('ExHentai: ничего не найдено (или куки не действительны / сайт изменил вёрстку)')
  }

  // Enrich with the official gdata metadata API (same as JHenTai) for
  // accurate rating / category / page count. Best-effort.
  try {
    const meta = await fetchGData(
      results.map((r) => extractGidToken(r.url)).filter((x): x is { gid: string; token: string } => !!x),
      {
        apiBase: opts.domainOverride ? 'https://api.e-hentai.org/api.php' : 'https://exhentai.org/api.php',
        cookieHeader: opts.cookieHeader,
        proxy,
        timeoutMs: proxy ? 120_000 : 20_000
      }
    )
    const byGid = new Map(meta.map((m) => [m.gid, m]))
    for (const r of results) {
      const gid = extractGid(r.url)
      const m = gid ? byGid.get(gid) : undefined
      if (!m) continue
      if (m.category) r.category = m.category
      const rc = Number(m.rating)
      if (!isNaN(rc) && rc > 0) r.rating = rc
      const fc = Number(m.filecount)
      if (!isNaN(fc) && fc > 0) r.pages = fc
    }
  } catch { /* best-effort */ }

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
    kind: r?.type?.name ?? null,
    score: typeof r?.avg_rating === 'number' ? r.avg_rating : null
  }))
}

// ── Senkuro ────────────────────────────────────────────────────────────

export async function searchSenkuro(query: string, cookieHeader = '', after?: string): Promise<CatalogItem[]> {
  const searchPart = query.trim() ? `search: "${query.trim()}"` : ''
  const afterPart = after ? `after: "${after}"` : ''
  const gql = JSON.stringify({ query: `query { mangas(first: 30 ${afterPart} ${searchPart} orderBy: { field: VIEWS direction: DESC }) { edges { node { id slug titles { lang content } type score cover { original { url } } } cursor } pageInfo { endCursor } } }` })
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'App-Id': '1006632962658', 'App-Version': '240626',
    Origin: 'https://senkuro.me', Accept: 'application/json',
    Referer: 'https://senkuro.me/browse/manga'
  }
  if (cookieHeader) {
    headers.Cookie = cookieHeader
    const token = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith('access_token='))?.slice('access_token='.length)
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const json = await httpPostJson('https://api.senkuro.org/graphql', gql, headers) as any
  const edges: any[] = json?.data?.mangas?.edges ?? []
  const items = edges.map((e) => {
    const n = e?.node ?? {}
    const title = n?.titles?.find((t: any) => t?.lang === 'RU')?.content
      ?? n?.titles?.find((t: any) => t?.lang === 'EN')?.content
      ?? 'Без названия'
    const rawType = n?.type ?? ''
    const kind = rawType === 'MANGA' || rawType === 'RU_MANGA' || rawType === 'OEL_MANGA' ? 'Манга'
      : rawType === 'MANHWA' ? 'Манхва'
      : rawType === 'MANHUA' ? 'Маньхуа'
      : rawType === 'COMICS' ? 'Комикс'
      : rawType || null
    return {
      url: `https://senkuro.me/manga/${n?.slug ?? ''}/`,
      title,
      coverUrl: n?.cover?.original?.url ?? null,
      pages: null,
      kind,
      score: typeof n?.score === 'number' ? n.score : null,
      cursor: typeof e?.cursor === 'string' ? e.cursor : null
    }
  })
  if (items.length === 0) throw new Error('Senkuro: ничего не найдено')
  return items
}

// ── Manga-shi ──────────────────────────────────────────────────────────

export async function searchMangaShi(
  query: string,
  proxy?: string,
  filters: CatalogFilters = {},
  page = 0,
  baseOverride?: string
): Promise<CatalogItem[]> {
  const base = baseOverride ?? 'https://manga-shi.org'
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
  // manga-shi.org pagination is 1-indexed on the wire; our page is 0-based.
  if (page > 0) params.push(`page=${page + 1}`)
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
    const kind = $(el).find('div.flex.justify-between span:first-child').first().text().trim() || null
    // Rating: find the badge div (a div whose two direct spans hold the
    // grade letter and the numeric score, e.g. "9,7"). Matched structurally
    // rather than by class name since the class list is Tailwind noise.
    let score: number | null = null
    $(el).find('div').each((_d, d) => {
      const directSpans = $(d).children('span')
      if (directSpans.length >= 2) {
        const v = directSpans.eq(1).text().trim().replace(',', '.')
        const n = Number(v)
        if (v !== 'n/a' && v !== '' && !isNaN(n)) {
          score = n
          return false
        }
      }
    })
    let chapterCount: number | null = null
    const ctText = $(el).find('i.ph-clock-clockwise').first().parent().find('span.shrink-0').first().text()
    const ctDigits = ctText.replace(/\D/g, '')
    if (ctDigits) chapterCount = Number(ctDigits)
    results.push({
      url: full, title,
      coverUrl: cover ? resolve(base, cover) : null,
      pages: null, kind, score, chapterCount
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
  opts: { proxy?: string; cookieHeader?: string; showPageCounts?: boolean; tags?: string[] } = {}
): Promise<CatalogItem[]> {
  const tagPart = (opts.tags ?? []).map((t) => `tag:${t}`).join(' ')
  const fullQuery = [query.trim(), tagPart].filter(Boolean).join(' ')
  const url = `${base}/search/?q=${encodeURIComponent(fullQuery)}&page=${page + 1}`
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
