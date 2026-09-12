import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseMangaSearch, parseChapterFeed, parseAggregate } from '../src/main/services/mangadex'

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))

describe('parseMangaSearch', () => {
  it('parses titles, kind, score, tags, cover', () => {
    const cards = parseMangaSearch(fixture('mangadex-search.json'))
    expect(cards).toHaveLength(2)
    const [c1, c2] = cards
    expect(c1.manga_id).toBe('a1b2c3')
    expect(c1.title).toBe('Герой')
    expect(c1.cover_url).toBe('https://uploads.mangadex.org/covers/a1b2c3/abc.jpg.256.jpg')
    expect(c1.kind).toBe('Манга')
    expect(c1.score).toBeCloseTo(9.12)
    expect(c1.tags).toEqual(['Экшен'])
    expect(c2.kind).toBe('Манхва')
    expect(c2.cover_url).toBeNull()
  })
})

describe('parseChapterFeed', () => {
  it('parses chapter numbers and titles, defaulting missing num to —', () => {
    const chs = parseChapterFeed(fixture('mangadex-feed.json'))
    expect(chs.map((c) => c.chapter_num)).toEqual(['1', '2.5', '—'])
    expect(chs[0].title).toBe('Начало')
    expect(chs[1].title).toBeNull()
    expect(chs.map((c) => c.chapter_id)).toEqual(['ch1', 'ch2', 'ch3'])
  })
})

describe('parseAggregate', () => {
  it('counts chapters across volumes', () => {
    expect(parseAggregate(fixture('mangadex-aggregate.json'))).toBe(5)
  })
})