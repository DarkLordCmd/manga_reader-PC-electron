import * as cheerio from 'cheerio'
import { httpFetch } from '../http'
import { type CatalogItem, type SimpleSiteConfig, resolve } from './catalog-types'

export function extractCoverFromSubtree($: cheerio.CheerioAPI, el: any): string | null {
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
