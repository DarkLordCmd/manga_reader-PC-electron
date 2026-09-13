import { describe, it, expect } from 'vitest'
import { parseSettings, defaultSettings, startPageFor } from '../src/shared/settings'

describe('parseSettings', () => {
  it('fills defaults for a missing object', () => {
    const s = parseSettings({})
    expect(s.reading_mode).toBe('Scroll')
    expect(s.width_scale).toBe(0.85)
    expect(s.pages_per_screen).toBe(2)
    expect(s.tor_socks_addr).toBe('127.0.0.1:9150')
    expect(s.show_thumbnails).toBe(true)
    expect(s.nhentai_show_page_counts).toBe(true)
    expect(s.show_r34_history).toBe(true)
  })

  it('preserves known fields and drops unknown ones', () => {
    const s = parseSettings({ width_scale: 0.5, bogus: 1 })
    expect(s.width_scale).toBe(0.5)
    expect((s as any).bogus).toBeUndefined()
  })

  it('parses history entries', () => {
    const s = parseSettings({
      viewing_history: [
        { url: 'u', series_id: 'sid', title: 't', cover_url: null, source: 'MangaDex',
          chapter_label: '1', chapter_index: 0, chapter_total: 5,
          current_page: 3, total_pages: 20, category: 'main', opened_at: 123 }
      ]
    })
    expect(s.viewing_history).toHaveLength(1)
    expect(s.viewing_history[0].current_page).toBe(3)
  })

  it('defaults empty sets/maps', () => {
    const s = parseSettings({})
    expect(s.tor_proxied_sites).toEqual([])
    expect(s.read_progress).toEqual({})
    expect(s.read_chapters).toEqual([])
    expect(s.eh_tag_bookmarks).toEqual([])
  })
})

describe('startPageFor', () => {
  it('returns saved page - 1', () => {
    expect(startPageFor('u', { u: [5, 10] })).toBe(4)
  })
  it('returns 0 for finished gallery', () => {
    expect(startPageFor('u', { u: [10, 10] })).toBe(0)
  })
  it('returns 0 when unknown', () => {
    expect(startPageFor('x', {})).toBe(0)
  })
})