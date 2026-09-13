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

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
export const TOR_UA = 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0'

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

export function resolve(base: string, href: string): string | null {
  try { return new URL(href, base).toString() } catch { return null }
}
