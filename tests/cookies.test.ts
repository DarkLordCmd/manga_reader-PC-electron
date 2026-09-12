import { describe, it, expect } from 'vitest'
import { parseCookieLines, CookieJar, cookieJarFromTampermonkey } from '../src/main/services/cookies'
import { mangaSeriesUrlFromChapterUrl } from '../src/main/services/sources'

describe('parseCookieLines', () => {
  it('parses JSON array format', () => {
    const jar = parseCookieLines('[{"name":"ipb_member_id","value":"123"},{"name":"igneous","value":"abc"}]')
    expect(jar.get('ipb_member_id')).toBe('123')
    expect(jar.get('igneous')).toBe('abc')
  })
  it('parses name=value per line', () => {
    const jar = parseCookieLines('a=1\nb=2')
    expect(jar.get('a')).toBe('1')
    expect(jar.get('b')).toBe('2')
  })
  it('parses ;-separated cURL format', () => {
    const jar = parseCookieLines('ipb_member_id=1; ipb_pass_hash=xyz; nw=1')
    expect(jar.get('ipb_pass_hash')).toBe('xyz')
  })
  it('headerString adds nw=1 and drops existing nw', () => {
    const jar = parseCookieLines('ipb_member_id=1; nw=1')
    expect(jar.headerString()).toBe('ipb_member_id=1; nw=1')
  })
  it('toRawLines round-trips', () => {
    const jar = parseCookieLines('a=1\nb=2')
    expect(CookieJar.fromRaw(jar.toRawLines()).get('b')).toBe('2')
  })
})

describe('cookieJarFromTampermonkey', () => {
  it('extracts E/Ex_Cookies stripping type tag', () => {
    const content = JSON.stringify({
      data: {
        'E/Ex_Cookies': 's[{"name":"ipb_member_id","value":"42"},{"name":"igneous","value":"mystery"}]',
        Share: 's{"0": [{"name":"ipb_member_id","value":"42"},{"name":"igneous","value":"REAL"}]}'
      }
    })
    const jar = cookieJarFromTampermonkey(content)
    expect(jar.get('ipb_member_id')).toBe('42')
    // real igneous cross-referenced from Share pool
    expect(jar.get('igneous')).toBe('REAL')
  })
})

describe('mangaSeriesUrlFromChapterUrl', () => {
  it('returns /manga/<slug>/ for remanga chapter', () => {
    expect(mangaSeriesUrlFromChapterUrl('https://remanga.org/manga/dororo/123/'))
      .toBe('https://remanga.org/manga/dororo/')
  })
  it('returns /manga/<slug>/ for senkuro chapter', () => {
    expect(mangaSeriesUrlFromChapterUrl('https://senkuro.me/manga/title/chapter/x'))
      .toBe('https://senkuro.me/manga/title/')
  })
  it('returns null for mangadex', () => {
    expect(mangaSeriesUrlFromChapterUrl('https://mangadex.org/foo')).toBeNull()
  })
})