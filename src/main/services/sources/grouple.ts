import * as cheerio from 'cheerio'
import { fetchHtmlSmart } from '../fetch-html'
import { assertLayout } from '../layout-watcher'
import { extractCoverFromSubtree } from './simple-sites'
import { resolve } from './catalog-types'
import type { SimpleSiteConfig, CatalogItem } from './catalog-types'
import type { ChapterInfo } from './remanga'

export const MARKERS = ['tile-link', 'tiles row', 'class="tile']
export const CHAPTER_MARKERS = ['chapters-link', 'chapter', '/v']

export const GROUPLE_SITES: SimpleSiteConfig[] = [
  { name: 'Readmanga', base: 'https://readmanga.me', catalogPath: '/list?type=&sortType=rate', searchPath: '/search?q=', linkMarker: '/manga/' },
  { name: 'Mintmanga', base: 'https://mintmanga.com', catalogPath: '/list?sortType=rate', searchPath: '/search?q=', linkMarker: '/manga/' },
  { name: 'Mangapoisk', base: 'https://mangapoisk.me', catalogPath: '/manga', searchPath: '?search=', linkMarker: '/manga/' }
]

// Paths that are navigation/utility pages, never series slugs.
const NON_SERIES_PREFIXES = new Set([
  'list', 'search', 'read', 'news', 'pages', 'users', 'login', 'logout',
  'register', 'auth', 'api', 'static', 'img', 'images', 'uploads', 'assets',
  'forum', 'wiki', 'support', 'rss', 'chapters', 'manga', 'tags', 'genres',
  'type', 'order', 'status', 'sort', 'recommendations', 'random', 'favorites',
  'collection', 'quote', 'logoff', 'about'
])

function sameHost(full: string, base: string): boolean {
  try { return new URL(full).host === new URL(base).host } catch { return false }
}

function isSeriesPath(full: string): boolean {
  try {
    const segs = new URL(full).pathname.split('/').filter(Boolean)
    if (segs.length === 0 || segs.length > 1) return false
    return !NON_SERIES_PREFIXES.has(segs[0].toLowerCase())
  } catch { return false }
}

function extractTitle($: cheerio.CheerioAPI, el: any): string {
  const t = $(el).find('.text-center').first().text().trim()
  if (t) return t
  const attr = $(el).attr('title')?.trim()
  if (attr) return attr
  const img = $(el).find('img').first()
  const imgTitle = (img.attr('title') || img.attr('alt') || '').trim()
  if (imgTitle) return imgTitle
  return $(el).text().trim()
}

export function parseGroupleListing(html: string, base: string, _page = 0): CatalogItem[] {
  assertLayout(MARKERS, html, 'Grouple')
  const $ = cheerio.load(html)
  const results: CatalogItem[] = []
  const seen = new Set<string>()
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') ?? ''
    if (!href) return
    const full = resolve(base, href)
    if (!full || seen.has(full)) return
    // Grouple series pages live at /<slug>/ (readmanga, mintmanga) but some
    // vendor variants keep the /manga/<slug>/ form — accept both.
    if (!href.includes('/manga/') && !(sameHost(full, base) && isSeriesPath(full))) return
    const title = extractTitle($, el)
    if (title.length < 2) return
    seen.add(full)
    const cover = extractCoverFromSubtree($, el)
    results.push({ url: full, title, coverUrl: cover ? resolve(base, cover) : null, pages: null })
  })
  return results
}

export async function searchGrouple(
  cfg: SimpleSiteConfig,
  query: string,
  page = 0,
  fetchOverride?: (url: string) => Promise<string>
): Promise<CatalogItem[]> {
  const target = query.trim()
    ? `${cfg.base}/api/catalog/search?q=${encodeURIComponent(query.trim())}&offset=${page * 50}`
    : `${cfg.base}${cfg.catalogPath}${page > 0 ? `${cfg.catalogPath.includes('?') ? '&' : '?'}page=${page + 1}` : ''}`
  const data = fetchOverride ? await fetchOverride(target) : await fetchHtmlSmart(target)
  const results = query.trim()
    ? parseGroupleSearchJson(data, cfg.base)
    : parseGroupleListing(data, cfg.base, page)
  if (results.length === 0) throw new Error(`${cfg.name}: ничего не найдено (или вёрстка изменилась)`)
  return results
}

/** JSON search results from /api/catalog/search (SPA search endpoint). */
export function parseGroupleSearchJson(jsonText: string, base: string): CatalogItem[] {
  const j = JSON.parse(jsonText) as any
  assertLayout(['"total"', '"list"'], jsonText, 'Grouple search')
  const list: any[] = j?.list ?? []
  return list
    .filter((m) => typeof m?.elementId?.linkName === 'string' && m.elementId.linkName.length > 0)
    .map((m) => ({
      url: `${base}/${m.elementId.linkName}/`,
      title: typeof m?.name === 'string' && m.name.trim() ? m.name.trim() : 'Без названия',
      coverUrl: typeof m?.picUrl === 'string' && m.picUrl ? m.picUrl : null,
      pages: typeof m?.chaptersCount === 'number' ? m.chaptersCount : null
    }))
}

// ── Grouple chapters ────────────────────────────────────────────────────

interface ChapterRef { vol: number | null; num: number | null }

/** Matches /<slug>/v<V>[/(c|chapter)?<C>] and /<slug>/vol<V>/<C> chapter paths. */
function chapterRefFromUrl(u: URL): ChapterRef | null {
  const segs = u.pathname.split('/').filter(Boolean)
  for (let i = 0; i < segs.length; i++) {
    const mV = segs[i].match(/^v(?:ol)?(\d+(?:\.\d+)?)$/i)
    if (!mV) continue
    const next = segs[i + 1] ?? ''
    const mC = next.match(/^(?:c(?:hapter)?)?(\d+(?:\.\d+)?)$/i)
    return { vol: Number(mV[1]), num: mC ? Number(mC[1]) : null }
  }
  return null
}

function groupleChapterLabel(ref: ChapterRef, text: string): string {
  const t = text.trim()
  if (/(том|глава|chapter)/i.test(t) && t.length >= 2) return t
  if (ref.vol != null && ref.num != null) return `Том ${ref.vol} Глава ${ref.num}`
  if (ref.num != null) return `Глава ${ref.num}`
  if (ref.vol != null) return `Том ${ref.vol}`
  return t || 'Глава'
}

function sortKey(ref: ChapterRef): number {
  return (ref.vol ?? 0) * 100000 + (ref.num ?? 0)
}

export async function fetchGroupleChapters(
  mangaUrl: string,
  fetchOverride?: (url: string) => Promise<string>
): Promise<ChapterInfo[]> {
  const base = mangaUrl.trim().replace(/\/+$/, '')
  const html = fetchOverride ? await fetchOverride(mangaUrl) : await fetchHtmlSmart(mangaUrl, { timeoutMs: 30_000 })
  assertLayout(CHAPTER_MARKERS, html, 'Grouple chapters')
  const $ = cheerio.load(html)
  const all: { info: ChapterInfo; ref: ChapterRef }[] = []
  const seen = new Set<string>()
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') ?? ''
    const full = resolve(base, href)
    if (!full || seen.has(full)) return
    try {
      const ref = chapterRefFromUrl(new URL(full))
      if (!ref) return
      seen.add(full)
      all.push({
        info: {
          chapter_id: full,
          chapter_num: groupleChapterLabel(ref, $(el).text()),
          title: null,
          lang: 'grouple'
        },
        ref
      })
    } catch { /* ignore malformed hrefs */ }
  })
  all.sort((a, b) => sortKey(a.ref) - sortKey(b.ref))
  if (all.length === 0) {
    throw new Error('На этой странице не нашлось ни одной главы — возможно, тайтл ещё не начали переводить, либо сайт изменил вёрстку.')
  }
  return all.map((a) => a.info)
}
