import * as cheerio from 'cheerio'
import { comxFetchText } from '../comx-gate'
import { type CatalogItem, type SimpleSiteConfig } from './catalog-types'

/** Com-X dedicated: DLE CMS markup + /reader/<news>/<chapter> pages and a
 * custom PoW challenge — everything routed through PoW-gate. */

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
  opts: { proxy?: string } = {}
): Promise<CatalogItem[]> {
  const target = query.trim()
    ? `${COMX_BASE}/search/${encodeURIComponent(query.trim())}/`
    : page > 0
      ? `${COMX_BASE}/comix-read/page/${page + 1}/`
      : `${COMX_BASE}/comix-read/`
  const html = await comxFetchText(target, { proxy: opts.proxy, timeoutMs: 30_000 })
  const results = parseComxListing(html, COMX_BASE)
  return results
}
