import * as cheerio from 'cheerio'
import { fetchHtmlSmart } from '../fetch-html'
import { assertLayout } from '../layout-watcher'
import { extractCoverFromSubtree } from './simple-sites'
import { resolve } from './catalog-types'
import type { SimpleSiteConfig, CatalogItem } from './catalog-types'
import type { ChapterInfo } from './remanga'

export const MARKERS = ['tile-link', 'tiles row', 'class="tile', 'card shadow mb-4']
export const CHAPTER_MARKERS = ['chapters-link', 'chapter', '/v', '/read']

export const GROUPLE_SITES: SimpleSiteConfig[] = [
  { name: 'Readmanga', base: 'https://readmanga.me', catalogPath: '/list?type=&sortType=rate', searchPath: '/search?q=', linkMarker: '/manga/' },
  { name: 'Mintmanga', base: 'https://mintmanga.com', catalogPath: '/list?sortType=rate', searchPath: '/search?q=', linkMarker: '/manga/' },
  { name: 'Mangapoisk', base: 'https://mangapoisk.me', catalogPath: '/', searchPath: '?search=', linkMarker: '/manga/' }
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

  // Strategy A: legacy grouple tiles (`tile-link` + .text-center).
  const tryLegacyTile = (el: any): { full: string; title: string } | null => {
    const href = $(el).attr('href') ?? ''
    if (!href) return null
    const full = resolve(base, href)
    if (!full) return null
    // Grouple series pages live at /<slug>/ (readmanga, mintmanga) but some
    // vendor variants keep the /manga/<slug>/ form — accept both.
    if (!href.includes('/manga/') && !(sameHost(full, base) && isSeriesPath(full))) return null
    const title = extractTitle($, el)
    if (title.length < 2) return null
    return { full, title }
  }

  // Strategy B: server-rendered card grids (`card shadow mb-4`, e.g.
  // mangapoisk.me) — <a href="/manga/<slug>" title="…"> with <img> inside.
  const tryCardBlock = (el: any): { full: string; title: string; pages: number | null } | null => {
    const href = $(el).attr('href') ?? ''
    if (!href.includes('/manga/')) return null
    // Chapter links (`/manga/<slug>/chapter/<v>-<n>`) point inside a card — skip.
    if (/\/manga\/[^/]+\/chapter\//.test(href)) return null
    const full0 = resolve(base, href)
    if (!full0) return null
    // Canonicalize: nav anchors append ?tab=… on the same slug — one entry.
    let full: string
    try {
      const u = new URL(full0)
      u.search = ''
      u.hash = ''
      full = u.toString()
    } catch { return null }
    const title = ($(el).attr('title') || $(el).find('img').first().attr('alt') || '').trim()
    if (title.length < 2) return null
    // Latest chapter number from the trailing "167 Глава" link, if present.
    const cardText = $(el).parent().text()
    const cm = cardText.match(/(\d+)\s*Глава/)
    return { full, title, pages: cm ? Number(cm[1]) : null }
  }

  $('div.card').each((_d, card) => {
    const a = $(card).find('a[href]').first()
    if (a.length === 0) return
    const hit = tryCardBlock(a)
    if (!hit || seen.has(hit.full)) return
    seen.add(hit.full)
    const cover = extractCoverFromSubtree($, card)
    results.push({ url: hit.full, title: hit.title, coverUrl: cover ? resolve(base, cover) : null, pages: hit.pages })
  })

  // On card-grid pages (e.g. mangapoisk) the generic anchor scan only adds
  // junk nav duplicates — stop after the card strategy produced results.
  if (html.includes('card shadow mb-4') && results.length > 0) return results

  $('a[href]').each((_i, el) => {
    const hit = tryCardBlock(el) ?? tryLegacyTile(el)
    if (!hit || seen.has(hit.full)) return
    seen.add(hit.full)
    const cover = extractCoverFromSubtree($, el)
    results.push({ url: hit.full, title: hit.title, coverUrl: cover ? resolve(base, cover) : null, pages: null })
  })
  return results
}

export async function searchGrouple(
  cfg: SimpleSiteConfig,
  query: string,
  page = 0,
  fetchOverride?: (url: string) => Promise<string>,
  opts: { proxy?: string } = {}
): Promise<CatalogItem[]> {
  const target = query.trim()
    ? `${cfg.base}/api/catalog/search?q=${encodeURIComponent(query.trim())}&offset=${page * 50}`
    // Servers ignore `page=` — the listing paginates by 50-item offset.
    : `${cfg.base}${cfg.catalogPath}${page > 0 ? `${cfg.catalogPath.includes('?') ? '&' : '?'}offset=${page * 50}` : ''}`
  const data = fetchOverride ? await fetchOverride(target) : await fetchHtmlSmart(target, { proxy: opts.proxy })
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

/** Matches /<slug>/v<V>[/(c|chapter)?<C>] and /<slug>/vol<V>/<C> chapter paths,
 * plus mangapoisk's /manga/<slug>/chapter/<V>-<N> format. */
function chapterRefFromUrl(u: URL): ChapterRef | null {
  const segs = u.pathname.split('/').filter(Boolean)
  for (let i = 0; i < segs.length; i++) {
    const mV = segs[i].match(/^v(?:ol)?(\d+(?:\.\d+)?)$/i)
    if (!mV) continue
    const next = segs[i + 1] ?? ''
    const mC = next.match(/^(?:c(?:hapter)?)?(\d+(?:\.\d+)?)$/i)
    return { vol: Number(mV[1]), num: mC ? Number(mC[1]) : null }
  }
  // mangapoisk: /manga/<slug>/chapter/<V>-<N>
  const ci = segs.findIndex((s) => s === 'chapter')
  if (ci >= 0) {
    const vn = (segs[ci + 1] ?? '').match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/)
    if (vn) return { vol: Number(vn[1]), num: Number(vn[2]) }
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
  fetchOverride?: (url: string) => Promise<string>,
  opts: { proxy?: string } = {}
): Promise<ChapterInfo[]> {
  const base = mangaUrl.trim().replace(/\/+$/, '')
  const html = fetchOverride ? await fetchOverride(mangaUrl) : await fetchHtmlSmart(mangaUrl, { timeoutMs: 30_000, proxy: opts.proxy })
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
