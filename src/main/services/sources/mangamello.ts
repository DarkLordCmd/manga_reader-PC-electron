import { httpGetJson } from '../http'
import { assertLayout } from '../layout-watcher'
import type { CatalogItem } from './catalog-types'
import type { ChapterInfo } from './remanga'

const BASE = 'https://api.mangamello.com/v1/mangas/'
const SITE = 'https://mangamello.com/manga/'

export function parseMangaMelloSearch(jsonText: string, _base: string): CatalogItem[] {
  const j = JSON.parse(jsonText) as any
  const arr: any[] = j?.results ?? j?.results ?? []
  assertLayout(['results', '"total"'], jsonText, 'MangaMello')
  return arr.map((m) => {
    const id = m?.idmanga ?? m?.id
    return {
      url: `${SITE}${id}/`,
      title: m?.title ?? 'Без названия',
      coverUrl: typeof m?.cover === 'string' ? m.cover : null,
      pages: typeof m?.chapter === 'number' ? m.chapter : null
    }
  })
}

export function parseMangaMelloChapter(jsonText: string): { title: string; pageUrls: string[] } {
  const j = JSON.parse(jsonText) as any
  assertLayout(['pages', '"chapter"'], jsonText, 'MangaMello')
  const pagesRaw = j?.pages ?? j?.page_images ?? j?.images ?? []
  const pages: string[] = (Array.isArray(pagesRaw) ? pagesRaw : [pagesRaw])
    .filter((u: any) => typeof u === 'string' && u.length > 0)
  if (pages.length === 0) throw new Error('MangaMello: глава без изображений')
  return { title: `MangaMello: ${j?.title ?? ''} глава ${j?.chapter ?? ''}`, pageUrls: pages }
}

export async function searchMangaMello(query: string, page = 0): Promise<CatalogItem[]> {
  const q = new URLSearchParams({ search: query.trim(), page: String(page + 1) })
  const raw = await httpGetJson(`${BASE}?${q.toString()}`, { Referer: BASE })
  return parseMangaMelloSearch(JSON.stringify(raw), BASE)
}

// MangaMello has no chapter-list endpoint in the documented API shape; the
// search response only carries the latest chapter count. Chapter list is
// therefore synthesized as 1..N chapter URLs on the site host.
export async function fetchMangaMelloChapters(mangaUrl: string): Promise<ChapterInfo[]> {
  const raw = await httpGetJson(mangaUrl.trim().replace(/\/+$/, '') + '/', { Referer: BASE })
  const j = raw as any
  const id = j?.idmanga ?? j?.id
  const count = typeof j?.chapter === 'number' ? j.chapter : (typeof j?.chapters === 'number' ? j.chapters : null)
  if (!id || !count || count < 1) throw new Error('MangaMello: не удалось получить список глав')
  const chapters: ChapterInfo[] = []
  for (let n = 1; n <= count; n++) {
    chapters.push({
      chapter_id: `${SITE}${id}/${n}/`,
      chapter_num: `Глава ${n}`,
      title: null,
      lang: 'mangamello'
    })
  }
  return chapters
}

export async function fetchMangaMelloChapter(chapterUrl: string): Promise<{ title: string; pageUrls: string[] }> {
  const segs = chapterUrl.trim().replace(/\/+$/, '').split('/').filter(Boolean)
  const nums = segs.filter((s) => /^\d+$/.test(s))
  const mangaId = nums[nums.length - 2] ?? ''
  const chapter = nums[nums.length - 1] ?? ''
  if (!mangaId || !chapter) throw new Error('MangaMello: не удалось разобрать URL главы')
  const raw = await httpGetJson(`${BASE}${mangaId}/${chapter}/`, { Referer: BASE })
  return parseMangaMelloChapter(JSON.stringify(raw))
}
