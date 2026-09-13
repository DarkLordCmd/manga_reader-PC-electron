import { resolveAtHome } from './mangadex'
import { fetchRemangaChapter, fetchSenkuroChapter, mangaSeriesUrlFromChapterUrl } from './sources'
import { fetchSimpleGallery } from './simple-gallery'

// Resolved fields (title, pageUrls, coverUrl, source, referer, mangaId, seriesId) mirror the
// former inline openUrl routing in src/main/index.ts so behavior stays byte-identical.
export interface GalleryResolution {
  title: string
  pageUrls: string[]
  coverUrl: string | null
  source: string
  referer: string | null
  mangaId: string | null
  seriesId: string
  proxy?: string
}

export class UnsupportedUrlError extends Error {
  constructor() {
    super('Неподдерживаемый URL')
  }
}

function isUuid(s: string): boolean {
  return s.length === 36 && [...s].every((c, i) =>
    (i === 8 || i === 13 || i === 18 || i === 23) ? c === '-' : /[0-9a-fA-F]/.test(c))
}

export function extractMangaDexChapterId(url: string): string | null {
  const t = url.trim()
  if (t.includes('mangadex.org')) {
    const pos = t.indexOf('/chapter/')
    if (pos >= 0) {
      const seg = t.slice(pos + '/chapter/'.length).split('/')[0]
      if (seg) return seg
    }
  }
  if (isUuid(t)) return t
  return null
}

export function sourceLabel(url: string): string {
  const l = url.toLowerCase()
  if (l.includes('mangadex')) return 'MangaDex'
  if (l.includes('exhentai')) return 'ExHentai'
  if (l.includes('e-hentai.org')) return 'E-Hentai'
  if (l.includes('nhentai')) return 'NHentai'
  if (l.includes('com-x.life')) return 'Com-X'
  if (l.includes('senkuro')) return 'Senkuro'
  if (l.includes('manga-shi')) return 'Manga-shi'
  if (l.includes('remanga')) return 'Remanga'
  if (l.includes('mangalib')) return 'Mangalib'
  if (l.includes('readmanga')) return 'Readmanga'
  if (l.includes('mintmanga')) return 'Mintmanga'
  if (l.includes('mangapoisk')) return 'Mangapoisk'
  return ''
}

export async function resolveGallery(
  url: string,
  opts: { proxy?: string; cookieHeader?: string }
): Promise<GalleryResolution> {
  const trimmed = url.trim()
  const seriesId = mangaSeriesUrlFromChapterUrl(trimmed) ?? trimmed
  const chapterId = extractMangaDexChapterId(trimmed)
  if (chapterId) {
    const atHome = await resolveAtHome(chapterId)
    const pageUrls = atHome.files.map((f) => `${atHome.baseUrl}/data/${atHome.hash}/${f}`)
    return { title: `MangaDex Chapter ${chapterId}`, pageUrls, coverUrl: null, source: 'MangaDex', referer: 'https://mangadex.org/', mangaId: seriesId, seriesId }
  }
  if (trimmed.includes('remanga.org/manga/')) {
    const r = await fetchRemangaChapter(trimmed)
    return { title: r.title, pageUrls: r.pageUrls, coverUrl: null, source: 'Remanga', referer: 'https://remanga.org/', mangaId: seriesId, seriesId }
  }
  if (trimmed.includes('senkuro') && trimmed.includes('/chapter/')) {
    const r = await fetchSenkuroChapter(trimmed)
    return { title: r.title, pageUrls: r.pageUrls, coverUrl: null, source: 'Senkuro', referer: `${r.base}/`, mangaId: seriesId, seriesId }
  }
  if (trimmed.includes('manga-shi.') || trimmed.includes('nhentai') || trimmed.includes('com-x.life') || trimmed.includes('mangalib.') || trimmed.includes('e-hentai.org') || trimmed.includes('exhentai')
    || trimmed.includes('readmanga.') || trimmed.includes('mintmanga.') || trimmed.includes('mangapoisk.')) {
    const g = await fetchSimpleGallery(trimmed, { proxy: opts.proxy, cookieHeader: opts.cookieHeader })
    return { title: g.title, pageUrls: g.pageUrls, coverUrl: g.coverUrl, source: sourceLabel(trimmed), referer: trimmed, proxy: opts.proxy, mangaId: seriesId, seriesId }
  }
  throw new UnsupportedUrlError()
}
