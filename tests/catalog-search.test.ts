import { describe, it, expect } from 'vitest'
import { createServer } from 'http'
import { searchSimpleSite, searchNhentai, extractGid } from '../src/main/services/catalog-search'

function serve(fn: (req: any, res: any) => void): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer(fn)
    server.listen(0, () => resolve({ port: (server.address() as any).port, close: () => server.close() }))
  })
}

describe('searchSimpleSite', () => {
  it('collects result links with covers', async () => {
    const { port, close } = await serve((_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(`
        <html><body>
          <a href="/manga/title-one/"><img src="/thumb1.webp" alt="Title One"><span>Title One</span> (34 pages)</a>
          <a href="/manga/title-two/"><img src="/thumb2.webp" alt="Title Two"><span>Title Two</span></a>
          <a href="/news/">not a result</a>
        </body></html>`)
    })
    const results = await searchSimpleSite({
      name: 'Test', base: `http://127.0.0.1:${port}`, catalogPath: '/', searchPath: '/search?q=',
      linkMarker: '/manga/'
    }, 'x')
    expect(results).toHaveLength(2)
    expect(results[0].title).toContain('Title One')
    expect(results[0].coverUrl).toContain('/thumb1.webp')
    expect(results[0].pages).toBe(34)
    close()
  })
})

describe('extractGid', () => {
  it('pulls the gallery id out of an ExHentai URL', () => {
    expect(extractGid('https://exhentai.org/g/123456/abcdef/')).toBe('123456')
    expect(extractGid('https://e-hentai.org/g/99/x/')).toBe('99')
    expect(extractGid('https://exhentai.org/')).toBeNull()
  })
})

describe('searchNhentai', () => {
  it('parses /g/ cover links', async () => {
    const { port, close } = await serve((_req, res) => {
      res.end(`
        <html><body>
          <div class="gallery">
            <a class="cover" href="/g/123456/" title="One Piece"><img data-src="//i.nhentai.net/cover.jpg" alt=""></a>
            <a class="cover" href="/g/789/" title="Naruto"><img data-src="//i.nhentai.net/cover2.jpg" alt=""></a>
          </div>
        </body></html>`)
    })
    const results = await searchNhentai(`http://127.0.0.1:${port}`, 'naruto', 0)
    expect(results).toHaveLength(2)
    expect(results[0].url).toContain('/g/123456/')
    expect(results[0].coverUrl).toContain('//i.nhentai.net/cover.jpg')
    close()
  })
})