import { describe, it, expect } from 'vitest'
import { buildEhSearchParams } from '../src/main/services/sources/eh'

describe('buildEhSearchParams', () => {
  it('includes f_search and f_cats', () => {
    expect(buildEhSearchParams({ query: 'a b', excludedCats: 3 })).toEqual(['f_search=a%20b', 'f_cats=3'])
  })
  it('includes f_srdd when minRating > 0', () => {
    expect(buildEhSearchParams({ query: '', minRating: 4 })).toContain('f_srdd=4')
    expect(buildEhSearchParams({ query: '', minRating: 0 })).not.toContain('f_srdd=0')
  })
  it('includes inline_set and cursor', () => {
    const p = buildEhSearchParams({ query: 'x', inlineSet: true, cursor: { dir: 'next', gid: '9' } })
    expect(p).toContain('inline_set=dm_t')
    expect(p).toContain('next=9')
  })
})
