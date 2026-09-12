import { describe, it, expect } from 'vitest'
import { HistoryManager } from '../src/main/services/history'

const u = (over: any = {}) => ({
  url: 'http://x/ch/1', series_id: 's1', title: 'Manga', cover_url: null,
  source: 'MangaDex', chapter_label: '1', chapter_index: 0, chapter_total: 10,
  total_pages: 20, category: 'main', ...over
})

describe('HistoryManager', () => {
  it('creates one card per series', () => {
    const h = new HistoryManager()
    h.addOrUpdate(u())
    h.addOrUpdate(u({ url: 'http://x/ch/2', chapter_index: 1 }))
    expect(h.all()).toHaveLength(1)
    expect(h.all()[0].chapter_index).toBe(1)
  })

  it('does not overwrite a further-read position with an earlier chapter', () => {
    const h = new HistoryManager()
    h.addOrUpdate(u({ chapter_index: 5 }))
    h.addOrUpdate(u({ url: 'http://x/ch/2', chapter_index: 1 }))
    expect(h.all()).toHaveLength(1)
    expect(h.all()[0].chapter_index).toBe(5)
    expect(h.all()[0].url).toBe('http://x/ch/1')
  })

  it('keeps saved page when reopening the same url', () => {
    const h = new HistoryManager()
    h.addOrUpdate(u())
    h.updateProgress('http://x/ch/1', 7, 20)
    h.addOrUpdate(u())
    expect(h.all()[0].current_page).toBe(7)
  })

  it('keeps an existing cover when update has none', () => {
    const h = new HistoryManager()
    h.addOrUpdate(u({ cover_url: 'http://c/1.jpg' }))
    h.addOrUpdate(u({ url: 'http://x/ch/2', chapter_index: 1, cover_url: null }))
    expect(h.all()[0].cover_url).toBe('http://c/1.jpg')
  })

  it('dedups by series on load and normalizes empty series_id', () => {
    const h = new HistoryManager()
    h.load([
      { ...u(), series_id: '', opened_at: 1 } as any,
      { ...u(), url: 'http://x/other', series_id: 's2', opened_at: 2 } as any
    ])
    expect(h.all()).toHaveLength(2)
    expect(h.all()[0].series_id).toBe('s2')
  })

  it('filters r34 vs main', () => {
    const h = new HistoryManager()
    h.addOrUpdate(u({ series_id: 'a', category: 'main' }))
    h.addOrUpdate(u({ series_id: 'b', category: 'r34', url: 'http://n/1' }))
    expect(h.mainEntries()).toHaveLength(1)
    expect(h.r34Entries()).toHaveLength(1)
  })
})