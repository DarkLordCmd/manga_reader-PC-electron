import { describe, it, expect } from 'vitest'
import { HistoryManager } from '../src/main/services/history'
import { InMemorySeriesRepository } from '../src/main/services/series-repository'

const base = {
  title: 't', cover_url: null, source: 'NHentai', chapter_label: null,
  chapter_index: null, chapter_total: null, category: 'r34'
}

describe('HistoryManager writes through to the repository', () => {
  it('persists into the repo passed to the constructor', () => {
    const repo = new InMemorySeriesRepository()
    const m = new HistoryManager(repo)
    m.load([{ ...base, url: 'https://nhentai.net/g/7/', series_id: 'https://nhentai.net/g/7/', current_page: 2, total_pages: 10, opened_at: 1000 }])
    expect(repo.get('nh:7')).not.toBeNull()
    expect(repo.get('nh:7')!.currentPage).toBe(2)
  })

  it('updateProgress writes to the repo', () => {
    const repo = new InMemorySeriesRepository()
    const m = new HistoryManager(repo)
    m.addOrUpdate({ ...base, url: 'https://nhentai.net/g/7/', series_id: 'https://nhentai.net/g/7/', current_page: 1, total_pages: 10 } as any)
    m.updateProgress('https://nhentai.net/g/7/', 4, 10)
    expect(repo.get('nh:7')!.currentPage).toBe(4)
  })

  it('does not reseed when the repo already has rows', () => {
    const repo = new InMemorySeriesRepository()
    new HistoryManager(repo).load([{ ...base, url: 'https://nhentai.net/g/7/', series_id: 'x', current_page: 1, total_pages: 1, opened_at: 1 }])
    const m2 = new HistoryManager(repo)
    m2.load([{ ...base, url: 'https://nhentai.net/g/99/', series_id: 'y', current_page: 1, total_pages: 1, opened_at: 2 }])
    expect(repo.get('nh:99')).toBeNull()
  })

  it('does not resurrect a tombstoned row when load is called again', () => {
    const repo = new InMemorySeriesRepository()
    new HistoryManager(repo).load([{ ...base, url: 'https://nhentai.net/g/7/', series_id: 'x', current_page: 1, total_pages: 1, opened_at: 1 }])
    repo.delete('nh:7')
    expect(repo.all()).toHaveLength(0)
    new HistoryManager(repo).load([{ ...base, url: 'https://nhentai.net/g/7/', series_id: 'x', current_page: 2, total_pages: 5, opened_at: 2 }])
    expect(repo.all()).toHaveLength(0)
    expect(repo.allIncludingDeleted()).toHaveLength(1)
  })

  it('resets currentPage when opening a different chapter of the same series', () => {
    const repo = new InMemorySeriesRepository()
    const m = new HistoryManager(repo)
    m.addOrUpdate({ ...base, url: 'https://senkuro.me/manga/foo/chapter/1/', series_id: 'https://senkuro.me/manga/foo/', current_page: 1, total_pages: 50 } as any)
    m.updateProgress('https://senkuro.me/manga/foo/chapter/1/', 20, 50)
    expect(repo.get('sk:foo')!.currentPage).toBe(20)
    m.addOrUpdate({ ...base, url: 'https://senkuro.me/manga/foo/chapter/2/', series_id: 'https://senkuro.me/manga/foo/', current_page: 1, total_pages: 40 } as any)
    expect(repo.get('sk:foo')!.currentPage).toBe(1)
    expect(repo.get('sk:foo')!.totalPages).toBe(50)
  })
})
