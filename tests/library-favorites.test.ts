import { describe, it, expect } from 'vitest'
import { LibraryService } from '../src/main/services/library'
import { InMemorySeriesRepository } from '../src/main/services/series-repository'

function make() {
  const repo = new InMemorySeriesRepository()
  return { svc: new LibraryService(repo, { autoAdd: () => false }), repo }
}

describe('LibraryService favorites', () => {
  it('addFavorite upserts and marks, without status', () => {
    const { svc, repo } = make()
    const it = svc.addFavorite({ url: 'https://nhentai.net/g/5/', title: 'F', coverUrl: null, source: 'NHentai', seriesId: 'https://nhentai.net/g/5/' })
    expect(it.favoritedAt).not.toBeNull()
    expect(it.status).toBeNull()
    expect(repo.list({ scope: 'favorites' })).toHaveLength(1)
  })

  it('setFavorite toggles, lookup reflects state', () => {
    const { svc } = make()
    svc.addFavorite({ url: 'https://nhentai.net/g/5/', title: 'F', coverUrl: null, source: 'NHentai', seriesId: 'x' })
    expect(svc.lookup('https://nhentai.net/g/5/', 'x')!.favorited).toBe(true)
    svc.setFavorite('nh:5', null)
    expect(svc.lookup('https://nhentai.net/g/5/', 'x')?.favorited).toBe(false)
  })

  it('setStatusFor upserts and sets status independently of favorite', () => {
    const { svc, repo } = make()
    const it = svc.setStatusFor({ url: 'https://nhentai.net/g/5/', title: 'F', coverUrl: null, source: 'NHentai', seriesId: 'x' }, 'completed')
    expect(it.status).toBe('completed')
    expect(it.favoritedAt).toBeNull()
    expect(repo.list({ scope: 'library' }).map((i) => i.key)).toEqual(['nh:5'])
  })

  it('countFavorites', () => {
    const { svc } = make()
    svc.addFavorite({ url: 'https://nhentai.net/g/5/', title: 'F', coverUrl: null, source: 'NHentai', seriesId: 'x' })
    svc.addFavorite({ url: 'https://nhentai.net/g/6/', title: 'G', coverUrl: null, source: 'NHentai', seriesId: 'y' })
    expect(svc.countFavorites()).toBe(2)
  })
})
