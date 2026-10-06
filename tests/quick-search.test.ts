import { describe, it, expect } from 'vitest'
import { normalizeQuickSearches, addQuickSearch, removeQuickSearch, moveQuickSearch, type QuickSearch } from '../src/shared/quick-search'
import { defaultSettings, parseSettings } from '../src/shared/settings'

const q = (id: string, name: string): QuickSearch => ({ id, name, source: 'exhentai', query: name })

describe('quick-search', () => {
  it('normalizes only valid entries', () => {
    expect(normalizeQuickSearches([{ id: '1', name: 'a', source: 'exhentai', query: 'x' }, { name: 'bad' }, null])).toEqual([
      { id: '1', name: 'a', source: 'exhentai', query: 'x' }
    ])
  })
  it('add/remove', () => {
    let list: QuickSearch[] = []
    list = addQuickSearch(list, q('1', 'a'))
    list = addQuickSearch(list, q('2', 'b'))
    expect(list.map((x) => x.id)).toEqual(['1', '2'])
    expect(removeQuickSearch(list, '1').map((x) => x.id)).toEqual(['2'])
  })
  it('move up/down clamps', () => {
    const list = [q('1', 'a'), q('2', 'b'), q('3', 'c')]
    expect(moveQuickSearch(list, '1', 'up').map((x) => x.id)).toEqual(['1', '2', '3'])
    expect(moveQuickSearch(list, '1', 'down').map((x) => x.id)).toEqual(['2', '1', '3'])
    expect(moveQuickSearch(list, '3', 'down').map((x) => x.id)).toEqual(['1', '2', '3'])
  })
})

describe('settings.quick_searches', () => {
  it('defaults empty and parses valid entries', () => {
    expect(defaultSettings().quick_searches).toEqual([])
    expect(parseSettings({ quick_searches: [{ id: '1', name: 'a', source: 'exhentai', query: 'x' }, { bad: 1 }] }).quick_searches)
      .toEqual([{ id: '1', name: 'a', source: 'exhentai', query: 'x' }])
  })
})
