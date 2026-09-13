import { httpPostJson } from '../http'
import { type CatalogItem } from './catalog-types'
import type { ChapterInfo } from './remanga'

const SENKURO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export function senkuroHeaders(cookieHeader: string): Record<string, string> {
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

export async function searchSenkuro(query: string, cookieHeader = '', after?: string): Promise<CatalogItem[]> {
  const searchPart = query.trim() ? `search: "${query.trim()}"` : ''
  const afterPart = after ? `after: "${after}"` : ''
  const gql = JSON.stringify({ query: `query { mangas(first: 30 ${afterPart} ${searchPart} orderBy: { field: VIEWS direction: DESC }) { edges { node { id slug titles { lang content } type score cover { original { url } } } cursor } pageInfo { endCursor } } }` })
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'App-Id': '1006632962658', 'App-Version': '240626',
    Origin: 'https://senkuro.me', Accept: 'application/json',
    Referer: 'https://senkuro.me/browse/manga'
  }
  if (cookieHeader) {
    headers.Cookie = cookieHeader
    const token = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith('access_token='))?.slice('access_token='.length)
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const json = await httpPostJson('https://api.senkuro.org/graphql', gql, headers) as any
  const edges: any[] = json?.data?.mangas?.edges ?? []
  const items = edges.map((e) => {
    const n = e?.node ?? {}
    const title = n?.titles?.find((t: any) => t?.lang === 'RU')?.content
      ?? n?.titles?.find((t: any) => t?.lang === 'EN')?.content
      ?? 'Без названия'
    const rawType = n?.type ?? ''
    const kind = rawType === 'MANGA' || rawType === 'RU_MANGA' || rawType === 'OEL_MANGA' ? 'Манга'
      : rawType === 'MANHWA' ? 'Манхва'
      : rawType === 'MANHUA' ? 'Маньхуа'
      : rawType === 'COMICS' ? 'Комикс'
      : rawType || null
    return {
      url: `https://senkuro.me/manga/${n?.slug ?? ''}/`,
      title,
      coverUrl: n?.cover?.original?.url ?? null,
      pages: null,
      kind,
      score: typeof n?.score === 'number' ? n.score : null,
      cursor: typeof e?.cursor === 'string' ? e.cursor : null
    }
  })
  if (items.length === 0) throw new Error('Senkuro: ничего не найдено')
  return items
}

export async function fetchSenkuroChapters(mangaSlug: string, cookieHeader = ''): Promise<ChapterInfo[]> {
  const mangaGql = JSON.stringify({
    query: `query { manga(slug: "${mangaSlug}") { id branches { id } titles { lang content } } }`
  })
  const mangaJson = await httpPostJson(
    'https://api.senkuro.org/graphql', mangaGql,
    { ...senkuroHeaders(cookieHeader), Referer: `https://senkuro.me/manga/${mangaSlug}/chapters` }
  ) as any
  const branchId: string = String(mangaJson?.data?.manga?.branches?.[0]?.id ?? '')
  if (!branchId) throw new Error('Senkuro: не удалось определить ветку')
  const mainName: string = mangaJson?.data?.manga?.titles?.find((t: any) => t?.lang === 'RU')?.content ?? ''

  const all: ChapterInfo[] = []
  let cursor: string | null = null
  for (;;) {
    const after = cursor ? `"${cursor}"` : 'null'
    const gql = JSON.stringify({
      query: `query { mangaChapters(first: 100, branchId: "${branchId}", after: ${after}, orderBy: { field: NUMBER, direction: ASC }) { edges { node { id slug name number volume } } pageInfo { endCursor hasNextPage } } }`
    })
    const json = await httpPostJson(
      'https://api.senkuro.org/graphql', gql,
      { ...senkuroHeaders(cookieHeader), Referer: 'https://senkuro.me/' },
      undefined, 30_000
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
    await new Promise((r) => setTimeout(r, 400))
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
