import { describe, it, expect } from 'vitest'
import { createServer, type Server } from 'http'
import { fetchSimpleGallery } from '../src/main/services/simple-gallery'

function serve(html: string): Promise<{ port: number; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    })
    server.listen(0, () => resolve({ port: (server.address() as any).port, server }))
  })
}

describe('fetchSimpleGallery', () => {
  it('extracts content img tags skipping logos', async () => {
    const { port, server } = await serve(`
      <html><head><title>Test Manga</title></head><body>
        <img src="/logo.png">
        <img src="https://cdn.example.com/1.jpg">
        <img data-src="https://cdn.example.com/2.webp">
      </body></html>`)
    const g = await fetchSimpleGallery(`http://127.0.0.1:${port}/chapter/1`)
    expect(g.title).toBe('Test Manga')
    expect(g.pageUrls).toEqual([
      'https://cdn.example.com/1.jpg',
      'https://cdn.example.com/2.webp'
    ])
    server.close()
  })

  it('parses nhentai embedded reader JSON', async () => {
    const html = `
      <html><body>
      <script>
        var reader = new N.reader({
          media_url: 'https://zrocdn.xyz/',
          gallery: { "media_id": "2438351",
            "images": { "pages": [{"t":"j"},{"t":"p"},{"t":"w"}] } }
        });
      </script>
      </body></html>`
    const { port, server } = await serve(html)
    const g = await fetchSimpleGallery(`http://127.0.0.1:${port}/g/2438351/1/`)
    expect(g.pageUrls).toEqual([
      'https://zrocdn.xyz/galleries/2438351/1.jpg',
      'https://zrocdn.xyz/galleries/2438351/2.png',
      'https://zrocdn.xyz/galleries/2438351/3.webp'
    ])
    server.close()
  })

  it('throws a clear error when no pages found', async () => {
    const { port, server } = await serve('<html><body>nothing</body></html>')
    await expect(fetchSimpleGallery(`http://127.0.0.1:${port}/x`)).rejects.toThrow(/Не удалось найти изображения/)
    server.close()
  })
})