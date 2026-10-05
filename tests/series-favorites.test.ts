import { describe, it, expect } from 'vitest'
import { InMemorySeriesRepository } from '../src/main/services/series-repository'
import type { SeriesUpsert } from '../src/shared/library'

const up = (over: Partial<SeriesUpsert> = {}): SeriesUpsert => ({
  key: 'nh:1', seriesId: 'nh:1', url: 'https://nhentai.net/g/1/', title: 'A',
  coverUrl: null, source: 'NHentai', category: 'main',
  currentPage: 1, totalPages: 10, chapterLabel: null, chapterIndex: null, chapterTotal: null,
  ...over
})

describe('favorites', () => {
  it('setFavorite marks and unmarks', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up())
    r.setFavorite('nh:1', 123)
    expect(r.get('nh:1')!.favoritedAt).toBe(123)
    r.setFavorite('nh:1', null)
    expect(r.get('nh:1')!.favoritedAt).toBeNull()
  })

  it('scope=favorites lists only favorites, scope=library only statuses', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'nh:1', url: 'https://nhentai.net/g/1/' }))
    r.upsertHistory(up({ key: 'nh:2', url: 'https://nhentai.net/g/2/' }))
    r.setStatus('nh:1', 'reading')
    r.setFavorite('nh:2', Date.now())
    expect(r.list({ scope: 'favorites' }).map((i) => i.key)).toEqual(['nh:2'])
    expect(r.list({ scope: 'library' }).map((i) => i.key)).toEqual(['nh:1'])
    expect(r.list({}).map((i) => i.key)).toEqual(['nh:1']) // default = library
  })

  it('upsertHistory preserves favoritedAt on update', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up())
    r.setFavorite('nh:1', 5)
    r.upsertHistory(up({ currentPage: 3 }))
    expect(r.get('nh:1')!.favoritedAt).toBe(5)
  })

  it('upsertHistory does not let a caller-supplied favoritedAt clobber the stored value', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up())
    r.setFavorite('nh:1', 5)
    r.upsertHistory(up({ currentPage: 3, favoritedAt: 999 }))
    expect(r.get('nh:1')!.favoritedAt).toBe(5)
  })
})
