import { httpFetch, httpGetJson, httpPostJson } from './http'

export function mangaSeriesUrlFromChapterUrl(url: string): string | null {
  const lower = url.toLowerCase()
  if (!(lower.includes('manga-shi.') || lower.includes('remanga.') || lower.includes('senkuro.'))) return null
  try {
    const u = new URL(url)
    const segs = u.pathname.split('/').filter(Boolean)
    const i = segs.findIndex((s) => s.toLowerCase() === 'manga')
    if (i >= 0 && segs[i + 1]) {
      const result = new URL(u)
      result.pathname = `/manga/${segs[i + 1]}/`
      result.search = ''
      result.hash = ''
      return result.toString()
    }
  } catch { /* ignore */ }
  return null
}

export interface ChapterInfo {
  chapter_id: string
  chapter_num: string
  title: string | null
  lang: string
}

const REMANGA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

export async function fetchRemangaChapters(mangaUrl: string): Promise<ChapterInfo[]> {
  const dir = mangaUrl.trim().replace(/\/+$/, '').split('/').pop() ?? ''
  if (!dir) throw new Error('Не удалось определить директорию тайтла')

  const titleJson = await httpGetJson(
    `https://remanga.org/api/v2/titles/${dir}/`,
    { Referer: 'https://remanga.org/', Accept: 'application/json' }
  ) as any
  const mainName: string = titleJson?.main_name ?? ''
  const branchId: number = titleJson?.branches?.[0]?.id ?? 0
  if (!branchId) throw new Error('Remanga: не удалось определить ID ветки')

  const all: { id: number; index: number; chapter: string; name: string | null }[] = []
  for (let page = 1; ; page++) {
    const q = new URLSearchParams({
      branch_id: String(branchId), ordering: '-index', count: '50',
      page: String(page), is_published: '1', detail: '1'
    })
    const json = await httpGetJson(
      `https://api.remanga.org/api/v2/titles/chapters/?${q.toString()}`,
      { Referer: 'https://remanga.org/', Accept: 'application/json' }
    ) as any
    const results: any[] = json?.results ?? []
    if (results.length === 0) break
    for (const ch of results) {
      all.push({
        id: ch?.id ?? 0,
        index: ch?.index ?? 0,
        chapter: ch?.chapter ?? '',
        name: typeof ch?.name === 'string' && ch.name ? ch.name : null
      })
    }
    if (typeof json?.next !== 'number' && !json?.next) break
    if (page > 50) break
  }

  if (all.length === 0) throw new Error('Remanga: список глав недоступен')
  all.sort((a, b) => a.index - b.index)
  return all.map((c) => ({
    chapter_id: `https://remanga.org/manga/${dir}/${c.id}/`,
    chapter_num: c.chapter,
    title: c.name ?? (mainName ? mainName : null),
    lang: 'remanga'
  }))
}

export async function fetchRemangaChapter(chapterUrl: string): Promise<{ title: string; pageUrls: string[] }> {
  const parts = chapterUrl.trim().replace(/\/+$/, '').split('/')
  const chapterId = parts.pop() ?? ''
  if (!chapterId) throw new Error('Не удалось определить ID главы')

  const json = await httpGetJson(
    `https://api.remanga.org/api/v2/titles/chapters/${chapterId}/`,
    { Referer: 'https://remanga.org/', Accept: 'application/json' }
  ) as any

  const chapterNum: string = json?.chapter ?? '?'
  const chapterName: string = typeof json?.name === 'string' ? json.name : ''
  const title = chapterName ? `Remanga: Глава ${chapterNum} — ${chapterName}` : `Remanga: Глава ${chapterNum}`

  const raw: string[] = []
  const spreads: any[] = json?.pages ?? []
  for (const spread of spreads) {
    if (Array.isArray(spread)) {
      for (const page of spread) {
        if (typeof page?.link === 'string') raw.push(page.link)
      }
    }
  }

  const pageNum = (u: string): number => {
    const fn = u.split('/').pop() ?? ''
    const m = fn.match(/^\d+/)
    return m ? Number(m[0]) : 0
  }
  raw.sort((a, b) => pageNum(a) - pageNum(b))
  if (raw.length === 0) throw new Error('Remanga: глава не содержит страниц')
  return { title, pageUrls: raw }
}

const SENKURO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function senkuroHeaders(cookieHeader: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'App-Id': '1006632962658',
    'App-Version': '240626',
    Origin: 'https://senkuro.me',
    Accept: 'application/json'
  }
  if (cookieHeader) {
    h.Cookie = cookieHeader
    const token = cookieHeader.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('access_token='))
      ?.slice('access_token='.length)
    if (token) h.Authorization = `Bearer ${token}`
  }
  return h
}

export async function fetchSenkuroChapters(mangaSlug: string, cookieHeader = ''): Promise<ChapterInfo[]> {
  const mangaGql = JSON.stringify({
    query: `query { manga(slug: "${mangaSlug}") { id branches { id } titles { lang content } } }`
  })
  const mangaJson = await httpPostJson(
    'https://api.senkuro.org/graphql', mangaGql,
    { ...senkuroHeaders(cookieHeader), Referer: `https://senkuro.me/manga/${mangaSlug}/chapters` }
  ) as any
  const branchId: number = mangaJson?.data?.manga?.branches?.[0]?.id ?? 0
  if (!branchId) throw new Error('Senkuro: не удалось определить ветку')
  const mainName: string = mangaJson?.data?.manga?.titles?.find((t: any) => t?.lang === 'RU')?.content ?? ''

  const all: ChapterInfo[] = []
  let cursor: string | null = null
  for (;;) {
    const after = cursor ? `"${cursor}"` : 'null'
    const gql = JSON.stringify({
      query: `query { mangaChapters(first: 100, branchId: ${branchId}, after: ${after}, orderBy: { field: NUMBER, direction: ASC }) { edges { node { id slug name number volume } } pageInfo { endCursor hasNextPage } } }`
    })
    const json = await httpPostJson(
      'https://api.senkuro.org/graphql', gql,
      { ...senkuroHeaders(cookieHeader), Referer: 'https://senkuro.me/' }
    ) as any
    const data = json?.data?.mangaChapters
    for (const edge of data?.edges ?? []) {
      const node = edge?.node ?? {}
      const slug: string = node.slug ?? ''
      const number: string = typeof node.number === 'number' ? String(node.number) : ''
      const name: string | null = typeof node.name === 'string' && node.name ? node.name : null
      all.push({
        chapter_id: `https://senkuro.me/manga/${mangaSlug}/chapter/${slug}`,
        chapter_num: number,
        title: name ?? (mainName ? mainName : null),
        lang: 'senkuro'
      })
    }
    cursor = data?.pageInfo?.endCursor ?? null
    if (!data?.pageInfo?.hasNextPage) break
  }
  if (all.length === 0) throw new Error('Senkuro: список глав пуст')
  return all
}

export async function fetchSenkuroChapter(chapterUrl: string): Promise<{ title: string; pageUrls: string[]; base: string }> {
  const slug = chapterUrl.trim().replace(/\/+$/, '').split('/').pop() ?? ''
  if (!slug) throw new Error('Senkuro: не удалось разобрать slug главы')
  const base = chapterUrl.includes('senkuro.com') ? 'https://senkuro.com' : 'https://senkuro.me'
  const gql = JSON.stringify({
    query: `query { mangaChapter(slug: "${slug}") { id name number pages { number image { original { url } compress: resize(width: 1200, quality: 80, format: WEBP) { url } } } } }`
  })
  const json = await httpPostJson(
    'https://api.senkuro.org/graphql', gql,
    { ...senkuroHeaders(''), Referer: `${base}/`, Origin: base }
  ) as any
  const chapter = json?.data?.mangaChapter
  const pages: any[] = chapter?.pages ?? []
  const pageUrls: string[] = []
  for (const p of pages) {
    const u = p?.image?.compress?.url ?? p?.image?.original?.url
    if (typeof u === 'string') pageUrls.push(u)
  }
  if (pageUrls.length === 0) throw new Error('Senkuro: не удалось извлечь URL страниц')
  const title = chapter?.name ?? String(chapter?.number ?? slug)
  return { title, pageUrls, base }
}