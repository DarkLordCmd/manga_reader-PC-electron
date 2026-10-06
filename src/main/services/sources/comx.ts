import * as cheerio from 'cheerio'
import { comxFetchText } from '../comx-gate'
import { fetchHtmlViaBrowser } from '../browser-fetch'
import { type ChapterInfo } from './remanga'
import { type CatalogItem, type SimpleSiteConfig } from './catalog-types'

/** Com-X dedicated: DLE CMS markup + /reader/<news>/<chapter> pages and a
 * custom PoW challenge — everything routed through PoW-gate. The chapter
 * list is rendered client-side, so it's collected through the hidden
 * BrowserWindow channel. */

export const COMX_BASE = 'https://com-x.life'

/** Catalog: DLE listing block (`.readed*` classes), pages at /comix-read/page/N/. */
export function parseComxListing(html: string, base: string): CatalogItem[] {
  const $ = cheerio.load(html)
  const results: CatalogItem[] = []
  const seen = new Set<string>()
  $('div.readed').each((_i, block) => {
    const href = $(block).find('a.readed__img').attr('href')
      ?? $(block).find('.readed__title a').attr('href')
    if (!href || !/\d+-[\w-]+\.html$/.test(href)) return
    const full = new URL(href.startsWith('http') ? href : new URL(href, base).toString()).toString()
    if (seen.has(full)) return
    const title = $(block).find('.readed__title a').first().text().trim()
    if (title.length < 2) return
    seen.add(full)
    const rawCover = $(block).find('a.readed__img img').attr('data-src') ?? $(block).find('a.readed__img img').attr('src') ?? ''
    const cover = rawCover?.startsWith('http') ? rawCover : rawCover ? new URL(rawCover, base).toString() : null
    results.push({ url: full, title, coverUrl: cover, pages: null })
  })
  return results
}

export async function searchComx(
  _cfg: SimpleSiteConfig,
  query: string,
  page = 0,
  opts: { proxy?: string; category?: string; genre?: string } = {}
): Promise<CatalogItem[]> {
  const cat = (opts.category ?? '').trim()
  const genre = (opts.genre ?? '').trim()
  let target: string
  if (query.trim()) {
    target = `${COMX_BASE}/search/${encodeURIComponent(query.trim())}/`
  } else if (cat && genre && cat === 'manga-2025-read') {
    // жанровые страницы сайта подтверждены только в разделе «Манга»
    const p = page > 0 ? `page/${page + 1}/` : ''
    target = `${COMX_BASE}/manga-2025-read/genre/${genre}/${p}`
  } else if (cat) {
    const p = page > 0 ? `page/${page + 1}/` : ''
    target = `${COMX_BASE}/comix-read/${cat}/${p}`
  } else {
    target = page > 0 ? `${COMX_BASE}/comix-read/page/${page + 1}/` : `${COMX_BASE}/comix-read/`
  }
  const html = await comxFetchText(target, { proxy: opts.proxy, timeoutMs: 30_000 })
  const results = parseComxListing(html, COMX_BASE)
  return results
}

/**
 * Chapter list is rendered client-side by their SPA — collect it through the
 * hidden BrowserWindow channel (JS runs, images stay disabled in prefs).
 * Chapters are sorted ascending by their chapter ids (their ids grow).
 */
export async function fetchComxChapters(mangaUrl: string): Promise<ChapterInfo[]> {
  const html = await fetchHtmlViaBrowser(mangaUrl, { timeoutMs: 60_000 })
  const $ = cheerio.load(html)
  const out: ChapterInfo[] = []
  const seen = new Set<string>()
  $('a[href*="/reader/"]').each((_i, el) => {
    const href = $(el).attr('href') ?? ''
    const m = href.match(/\/reader\/(\d+)\/(\d+)/)
    if (!m) return
    const full = href.startsWith('http') ? href : new URL(href, COMX_BASE).toString()
    if (seen.has(full)) return
    seen.add(full)
    const rawLabel = $(el).text().trim().replace(/\s+/g, ' ')
    const label = /Том|Глава|Вып/i.test(rawLabel) ? rawLabel : `Глава ${m[2]}`
    out.push({ chapter_id: full, chapter_num: label, title: null, lang: 'comx' })
  })
  if (out.length === 0) throw new Error('Com-X: список глав не отрендерился (возможно, анти-бот сменил разметку)')
  out.sort((a, b) => Number(b.chapter_id.split('/').pop()) - Number(a.chapter_id.split('/').pop()))
  return out
}
