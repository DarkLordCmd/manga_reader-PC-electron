import { describe, it, expect, afterEach, vi } from 'vitest'
import { httpFetch } from '../src/main/services/http'

describe('httpFetch error unwrapping', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('surfaces the undici fetch-failed cause as an actionable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: new Error('connect ECONNREFUSED 127.0.0.1:9150')
      })
    }))
    await expect(
      httpFetch({ url: 'http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion/' })
    ).rejects.toThrow(/Tor SOCKS \(127\.0\.0\.1:9150\)/)
  })
})
