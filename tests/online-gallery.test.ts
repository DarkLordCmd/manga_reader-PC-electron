import { describe, it, expect } from 'vitest'
import { createServer } from 'http'
import { createOnlineGallery, setReadingPosition, requestPage, MAX_CONCURRENT } from '../src/main/services/online-gallery'

describe('online gallery', () => {
  it('fetches and caches pages, honors concurrency', async () => {
    let active = 0
    let peak = 0
    const server = createServer((req, res) => {
      active++
      peak = Math.max(peak, active)
      setTimeout(() => { active--; res.end(`img-${req.url}`) }, 5)
    })
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as any).port
    const gid = createOnlineGallery('Test', [
      `http://127.0.0.1:${port}/1`,
      `http://127.0.0.1:${port}/2`,
      `http://127.0.0.1:${port}/3`
    ])
    const results = await Promise.all([0, 1, 2].map((i) => requestPage(gid, i, {})))
    expect(results.map((b) => b?.toString())).toEqual(['img-/1', 'img-/2', 'img-/3'])
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT)
    server.close()
  })

  it('throws a clear error on non-200', async () => {
    const server = createServer((_req, res) => { res.statusCode = 404; res.end('nope') })
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as any).port
    const gid = createOnlineGallery('Bad', [`http://127.0.0.1:${port}/x`])
    await expect(requestPage(gid, 0, {})).rejects.toThrow(/HTTP 404/)
    server.close()
  })
})