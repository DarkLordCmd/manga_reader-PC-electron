import { describe, it, expect } from 'vitest'
import { InMemorySeriesRepository } from '../src/main/services/series-repository'
import type { SeriesUpsert } from '../src/shared/library'

const up = (over: Partial<SeriesUpsert> = {}): SeriesUpsert => ({
  key: 'nh:1', seriesId: 'nh:1', url: 'https://nhentai.net/g/1/', title: 'A',
  coverUrl: null, source: 'NHentai', category: 'r34',
  currentPage: 1, totalPages: 10, chapterLabel: null, chapterIndex: null, chapterTotal: null,
  ...over
})

describe('InMemorySeriesRepository', () => {
  it('upserts history and preserves library fields', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up())
    r.setStatus('nh:1', 'reading')
    r.setNote('nh:1', 'hello')
    r.upsertHistory(up({ currentPage: 5, totalPages: 12 }))
    const it = r.get('nh:1')!
    expect(it.status).toBe('reading')
    expect(it.note).toBe('hello')
    expect(it.currentPage).toBe(5)
    expect(it.totalPages).toBe(12)
  })

  it('takes max progress and fills missing cover', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ currentPage: 7, totalPages: 10, coverUrl: 'c1' }))
    r.upsertHistory(up({ currentPage: 3, totalPages: 20, coverUrl: null }))
    const it = r.get('nh:1')!
    expect(it.currentPage).toBe(7)
    expect(it.totalPages).toBe(20)
    expect(it.coverUrl).toBe('c1')
  })

  it('list returns only library items and filters', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'nh:1', title: 'Alpha' }))
    r.upsertHistory(up({ key: 'nh:2', title: 'Beta' }))
    r.setStatus('nh:2', 'planned')
    expect(r.list({ status: 'all' }).map((i) => i.key)).toEqual(['nh:2'])
    expect(r.list({ status: 'planned' }).map((i) => i.key)).toEqual(['nh:2'])
    expect(r.list({ status: 'reading' })).toHaveLength(0)
  })

  it('respects includeR34=false and search/sort', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'a:1', url: 'https://a/1', title: 'Zeta', category: 'main' }))
    r.upsertHistory(up({ key: 'nh:2', title: 'Beta', category: 'r34' }))
    r.setStatus('a:1', 'completed')
    r.setStatus('nh:2', 'reading')
    expect(r.list({ status: 'all', includeR34: false }).map((i) => i.key)).toEqual(['a:1'])
    expect(r.list({ status: 'all', search: 'bet' }).map((i) => i.key)).toEqual(['nh:2'])
    expect(r.list({ status: 'all', sort: 'title' }).map((i) => i.title)).toEqual(['Beta', 'Zeta'])
  })

  it('clearHistory keeps library rows', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'nh:1' }))
    r.upsertHistory(up({ key: 'nh:2' }))
    r.setStatus('nh:2', 'reading')
    r.clearHistory()
    expect(r.get('nh:1')).toBeNull()
    expect(r.get('nh:2')).not.toBeNull()
  })

  it('counts by status', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'nh:1' }))
    r.upsertHistory(up({ key: 'nh:2' }))
    r.setStatus('nh:1', 'reading')
    r.setStatus('nh:2', 'reading')
    expect(r.countByStatus()).toEqual({ reading: 2 })
  })

  it('importItems merges by newest updatedAt', () => {
    const r = new InMemorySeriesRepository()
    r.upsertHistory(up({ key: 'nh:1', title: 'Old' }))
    const base = r.get('nh:1')!
    const res = r.importItems([
      { ...base, title: 'Newer', updatedAt: base.updatedAt + 1000 },
      { ...base, key: 'nh:9', title: 'Fresh', updatedAt: base.updatedAt }
    ])
    expect(res).toEqual({ added: 1, updated: 1 })
    expect(r.get('nh:1')!.title).toBe('Newer')
    expect(r.get('nh:9')).not.toBeNull()
  })
})
