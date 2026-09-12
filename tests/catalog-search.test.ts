import { describe, it, expect } from 'vitest'
import { createServer } from 'http'
import {
  searchSimpleSite, searchNhentai, extractGid, extractGidToken, searchMangaShi, ehErrorFromResponse, fetchGData,
  parseExHentaiListing
} from '../src/main/services/catalog-search'

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

describe('extractGidToken', () => {
  it('parses gid and token from a gallery URL', () => {
    expect(extractGidToken('https://exhentai.org/g/123456/abcdef1234/')).toEqual({ gid: '123456', token: 'abcdef1234' })
    expect(extractGidToken('https://exhentai.org/')).toBeNull()
  })
})

describe('fetchGData', () => {
  it('batches gidlist and maps gmetadata', async () => {
    const { port, close } = await serve((req, res) => {
      let body = ''
      req.on('data', (d) => { body += d })
      req.on('end', () => {
        const parsed = JSON.parse(body)
        const gidlist: [string, string][] = parsed.gidlist
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          gmetadata: gidlist.map(([gid, token]) => ({
            gid, token, title: `Title ${gid}`, category: 'Manga', rating: '4.8',
            filecount: '30', expunged: false, tags: ['female:big breasts']
          }))
        }))
      })
    })
    const results = await fetchGData([{ gid: '1', token: 'a' }, { gid: '2', token: 'b' }], {
      apiBase: `http://127.0.0.1:${port}/api.php`
    })
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('Title 1')
    expect(results[0].category).toBe('Manga')
    expect(results[0].rating).toBe('4.8')
    expect(results[0].filecount).toBe('30')
    close()
  })
})

describe('searchMangaShi', () => {
  it('parses kind, rating and chapter count from cards', async () => {
    const { port, close } = await serve((_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(`
        <html><body>
          <a href="/manga/berserk/" class="media-shell">
            <img src="/cover1.jpg"><h3>Берсерк</h3>
            <div class="flex justify-between"><span>Манхва</span><span>s</span></div>
            <div><span>A</span><span>9,7</span></div>
            <div><i class="ph-clock-clockwise"></i><span class="shrink-0">132</span></div>
          </a>
          <a href="/manga/one-piece/" class="media-shell">
            <img src="/cover2.jpg"><h3>Ван-Пис</h3>
            <div class="flex justify-between"><span>Манга</span><span>s</span></div>
            <div><span>--</span><span>n/a</span></div>
          </a>
        </body></html>`)
    })
    const results = await searchMangaShi('x', undefined, {}, 0, `http://127.0.0.1:${port}`)
    expect(results[0].kind).toBe('Манхва')
    expect(results[0].score).toBe(9.7)
    expect(results[0].chapterCount).toBe(132)
    expect(results[1].kind).toBe('Манга')
    expect(results[1].score).toBeNull()
    close()
  })
})

describe('ehErrorFromResponse', () => {
  it('detects sad panda blank body', () => {
    const err = ehErrorFromResponse(200, '')
    expect(err).toMatch(/пустым телом|sad panda/)
  })
  it('detects banned IP and image limit', () => {
    expect(ehErrorFromResponse(200, 'Your IP address has been banned.')).toMatch(/IP забанен/)
    expect(ehErrorFromResponse(200, 'You have exceeded your image viewing limits.')).toMatch(/лимит/)
  })
  it('detects cloudflare 403', () => {
    expect(ehErrorFromResponse(403, 'html')).toMatch(/Cloudflare/)
  })
  it('returns null for a normal page', () => {
    expect(ehErrorFromResponse(200, '<html>normal listing</html>')).toBeNull()
  })
})

describe('parseExHentaiListing', () => {
  const html = `<table class="itg gltc"><tbody>
    <tr class="gtr0">
      <td class="gl1c glcat"><div class="cn">Manga</div></td>
      <td class="gl2c"><div class="glthumb"><img src="/t/1.jpg"></div></td>
      <td class="gl3c glname"><a href="/g/1000/abc123/">Some Title</a></td>
      <td class="gl4c glhide"><div>1</div><div>66 pages</div></td>
    </tr>
    <tr class="gtr1">
      <td class="gl1c glcat"><div class="cn">Doujinshi</div></td>
      <td class="gl2c"><div class="glthumb"><img src="/t/2.jpg"></div></td>
      <td class="gl3c glname"><a href="/g/2000/def456/">Another</a></td>
      <td class="gl4c glhide"><div>1</div><div>30 pages</div></td>
    </tr>
    <tr><th>header</th></tr>
  </tbody></table>`

  it('parses compact rows: url, title, category, pages', () => {
    const rows = parseExHentaiListing(html, 'https://exhentai.org')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      url: 'https://exhentai.org/g/1000/abc123/',
      title: 'Some Title',
      category: 'Manga',
      pages: 66
    })
    expect(rows[1].category).toBe('Doujinshi')
    expect(rows[1].pages).toBe(30)
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