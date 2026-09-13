import * as cheerio from 'cheerio'
import { httpFetch } from '../http'
import { type CatalogItem, resolve } from './catalog-types'
import { assertLayout } from '../layout-watcher'

export function parseNhentaiPageCount(html: string): number | null {
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
  assertLayout(['class="cover"', '/g/'], r.text, 'NHentai')
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
