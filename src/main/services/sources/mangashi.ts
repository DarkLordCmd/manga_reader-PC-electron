import * as cheerio from 'cheerio'
import { fetchHtmlSmart } from '../fetch-html'
import { type CatalogItem, type CatalogFilters, resolve } from './catalog-types'
import type { ChapterInfo } from './remanga'

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
  const text = await fetchHtmlSmart(url, { proxy })
  const $ = cheerio.load(text)
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
  const page1 = await fetchHtmlSmart(mangaUrl, { proxy, timeoutMs: 30_000 })

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

  parseChapters(page1)

  let page = findNextPage(page1)
  while (page != null && page <= 200) {
    const target = `${base}/chapters/?chapter_sort=latest&page=${page}`
    const r = await fetchHtmlSmart(target, { proxy, timeoutMs: 30_000 })
    parseChapters(r)
    const next = findNextPage(r)
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
