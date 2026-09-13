import { describe, it, expect, vi, beforeEach } from 'vitest'

const httpGetJson = vi.fn()
vi.mock('../src/main/services/http', () => ({ httpGetJson: (...a: any[]) => httpGetJson(...a) }))
; (globalThis as any).__mockRm = httpGetJson

import { searchRemanga } from '../src/main/services/sources/remanga'

describe('searchRemanga params', () => {
  beforeEach(() => { httpGetJson.mockReset(); httpGetJson.mockResolvedValue([]) })
  it('uses views ordering by default and omits empty query', async () => {
    await searchRemanga('', 0, {})
    expect(httpGetJson).toHaveBeenCalledTimes(1)
    const url = httpGetJson.mock.calls[0][0] as string
    expect(url).toContain('ordering=views')
    expect(url).not.toContain('query=')
  })
  it('passes through chosen orderings', async () => {
    await searchRemanga('berserk', 0, { remangaOrdering: '-rating' })
    const url = httpGetJson.mock.calls[0][0] as string
    expect(url).toContain('ordering=-rating')
    expect(url).toContain('query=berserk')
  })
})
