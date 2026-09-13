import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { searchGrouple, GROUPLE_SITES, fetchGroupleChapters } from '../src/main/services/sources/grouple'
import { mangaSeriesUrlFromChapterUrl } from '../src/main/services/sources/remanga'
import type { CatalogItem } from '../src/main/services/sources/catalog-types'

const html = readFileSync(join('tests', 'fixtures', 'grouple-list.html'), 'utf-8')

describe('GROUPLE_SITES', () => {
  it('has readmanga/mintmanga/mangapoisk', () => {
    expect(GROUPLE_SITES.map((s) => s.name)).toEqual(['Readmanga', 'Mintmanga', 'Mangapoisk'])
    expect(GROUPLE_SITES[0].base).toBe('https://readmanga.me')
  })
})

describe('searchGrouple parse', () => {
  it('extracts tiles and covers', async () => {
    // searchGrouple принимает parse-callback для тестов
    const items: CatalogItem[] = await searchGrouple(GROUPLE_SITES[0], '', 0, (url) => {
      if (url === `${GROUPLE_SITES[0].base}/list?type=&sortType=rate`) return Promise.resolve(html)
      throw new Error('unexpected ' + url)
    })
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('Берсерк')
    expect(items[0].url).toBe('https://readmanga.me/berserk-/')
    expect(items[0].coverUrl).toBe('https://readmanga.me/img/cover1.jpg')
  })

  it('excludes navigation links that masquerade as series', async () => {
    const junkHtml = html.replace('</body>', `
  <a href="/collection">Коллекции</a>
  <a href="/quote">Цитаты</a>
  <a href="/logoff">Выход</a>
  <a href="/about">О нас</a>
</body>`)
    const items = await searchGrouple(GROUPLE_SITES[0], '', 0, (url) => {
      if (url === `${GROUPLE_SITES[0].base}/list?type=&sortType=rate`) return Promise.resolve(junkHtml)
      throw new Error('unexpected ' + url)
    })
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.url)).not.toContain('https://readmanga.me/collection')
  })

  it('parses JSON search results from the SPA api', async () => {
    const searchJson = readFileSync(join('tests', 'fixtures', 'grouple-search-api.json'), 'utf-8')
    const items = await searchGrouple(GROUPLE_SITES[0], 'berserk', 0, (url) => {
      if (url === `${GROUPLE_SITES[0].base}/api/catalog/search?q=berserk&offset=0`) return Promise.resolve(searchJson)
      throw new Error('unexpected ' + url)
    })
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('Ненасытный Берсерк')
    expect(items[0].url).toBe('https://readmanga.me/nenasytnyi_berserk/')
    expect(items[0].coverUrl).toBe('https://rm.one-way.work/uploads/pics/01/92/177.webp')
    expect(items[0].pages).toBe(92)
    expect(items[1].pages).toBeNull()
  })

  it('paginates JSON search with offset', async () => {
    const searchJson = readFileSync(join('tests', 'fixtures', 'grouple-search-api.json'), 'utf-8')
    await searchGrouple(GROUPLE_SITES[0], 'berserk', 2, (url) => {
      if (url === `${GROUPLE_SITES[0].base}/api/catalog/search?q=berserk&offset=100`) return Promise.resolve(searchJson)
      throw new Error('unexpected ' + url)
    })
  })

  it('paginates the listing by 50-item offset', async () => {
    await searchGrouple(GROUPLE_SITES[0], '', 2, (url) => {
      if (url === `${GROUPLE_SITES[0].base}/list?type=&sortType=rate&offset=100`) return Promise.resolve(html)
      throw new Error('unexpected ' + url)
    })
  })
})

describe('fetchGroupleChapters', () => {
  const seriesHtml = `
    <html><body>
      <div class="item-content">
        <a class="chapter-link" href="/berserk-/v10/c25">Том 10 Глава 25</a>
        <a class="chapter-link" href="/berserk-/v1/c1">Том 1 Глава 1</a>
        <a class="chapter-link" href="/berserk-/v2/c3">Том 2 Глава 3</a>
        <a href="/news/">not a chapter</a>
      </div>
    </body></html>`

  it('collects v/c chapter links sorted ascending', async () => {
    const chapters = await fetchGroupleChapters('https://readmanga.me/berserk-/', async (url) => {
      if (url === 'https://readmanga.me/berserk-/') return seriesHtml
      throw new Error('unexpected ' + url)
    })
    expect(chapters).toHaveLength(3)
    expect(chapters[0].chapter_id).toBe('https://readmanga.me/berserk-/v1/c1')
    expect(chapters[0].chapter_num).toBe('Том 1 Глава 1')
    expect(chapters[2].chapter_num).toBe('Том 10 Глава 25')
  })

  it('derives chapter num from url when link text is empty', async () => {
    const bare = `
      <html><body>
        <a href="/x-/v4/c12"><img src="a.png"></a>
        <a href="/x-/v4">Том 4</a>
      </body></html>`
    const chapters = await fetchGroupleChapters('https://mintmanga.com/x-/', async (url) => {
      if (url === 'https://mintmanga.com/x-/') return bare
      throw new Error('unexpected ' + url)
    })
    expect(chapters.map((c) => c.chapter_num)).toEqual(['Том 4', 'Том 4 Глава 12'])
  })

  it('parses decimal chapter numbers and sorts them numerically', async () => {
    const decimal = `
      <html><body>
        <a class="chapter-link" href="/berserk-/v1/c26">Глава 26</a>
        <a class="chapter-link" href="/berserk-/v1/c25.5">Глава 25.5</a>
        <a class="chapter-link" href="/berserk-/v1/c25">Глава 25</a>
      </body></html>`
    const chapters = await fetchGroupleChapters('https://readmanga.me/berserk-/', async (url) => {
      if (url === 'https://readmanga.me/berserk-/') return decimal
      throw new Error('unexpected ' + url)
    })
    expect(chapters.map((c) => c.chapter_num)).toEqual(['Глава 25', 'Глава 25.5', 'Глава 26'])
    expect(chapters[1].chapter_id).toBe('https://readmanga.me/berserk-/v1/c25.5')
  })
})

describe('mangaSeriesUrlFromChapterUrl grouple edge cases', () => {
  it('maps slugs that merely start with "manga"', () => {
    expect(mangaSeriesUrlFromChapterUrl('https://readmanga.me/mangiakarasu/v1/')).toBe('https://readmanga.me/mangiakarasu/')
  })
})
