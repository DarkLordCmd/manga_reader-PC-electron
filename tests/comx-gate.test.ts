import { describe, it, expect, vi, beforeEach } from 'vitest'

const httpFetch = vi.fn()
vi.mock('../src/main/services/http', () => ({ httpFetch: (...a: any[]) => httpFetch(...a) }))

import {
  solvePow, parseChallenge, buildValidationBody, isChallenge,
  storeCookies, cookieForHost, ensureComxClearance
} from '../src/main/services/comx-gate'

const challengeHtml = `<html><body><script>
(function(){
    var targetUrl = decodeURIComponent("https%3A%2F%2Fcom-x.life%2F");
    var token = "NDYuMTYwLjM5LjkyfDE3ODkzNzI1NTV8Mnw3MDMwMDB8NDg3NDI0MzBkMTM1MWMyOTY2YmU5MjY4ODJiNGU0YzY%3D";
    function sendResult(){ /* ...missing + powNonce + powHash */ }
</script></body></html>`

describe('comx-gate PoW', () => {
  describe('solvePow', () => {
    it('finds a nonce whose sha256 token:nonce starts with 00', async () => {
      const r = await solvePow('test-token')
      expect(r).not.toBeNull()
      expect(r!.pow_hash.startsWith('00')).toBe(true)
      expect(Number(r!.pow_nonce)).toBeLessThan(100000)
    })
  })

  describe('parseChallenge', () => {
    it('extracts token and target from challenge html', () => {
      const info = parseChallenge(challengeHtml)
      expect(info).not.toBeNull()
      expect(info!.targetUrl).toBe('https://com-x.life/')
      expect(info!.token).toContain('NDYu')
    })
  })

  describe('buildValidationBody', () => {
    it('builds the sendResult-equivalent POST body', async () => {
      const t = { token: 'abc', targetUrl: 'https://x/' }
      const pow = await solvePow('abc')
      const body = buildValidationBody({ ...t }, pow)
      expect(body).toContain('token=abc')
      expect(body).toContain('mode=modern')
      expect(body).toContain(`pow_nonce=${pow!.pow_nonce}`)
      expect(body).toContain('webdriver=0')
      expect(body).toContain('cdp=0')
    })
  })

  describe('isChallenge', () => {
    it('detects challenge page, not normal page', () => {
      expect(isChallenge(challengeHtml)).toBe(true)
      expect(isChallenge('<html><body><a href="/manga/x">ok</a></body></html>')).toBe(false)
    })
  })

  describe('cookie store', () => {
    beforeEach(() => {
      // reset the module's in-memory store between tests
      vi.resetModules()
    })
    it('merges cookies per name, later wins', () => {
      storeCookies('com-x.life', ['sid=1; Path=/; HttpOnly', 'foo=bar; Path=/'])
      storeCookies('com-x.life', ['sid=2; Path=/'])
      const c = cookieForHost('com-x.life')
      expect(c).toContain('sid=2')
      expect(c).toContain('foo=bar')
    })
  })

  describe('ensureComxClearance flow', () => {
    it('solves challenge and returns cleared html', async () => {
      const goodHtml = '<html><body><a href="/manga/x">ok</a></body></html>'
      httpFetch.mockReset()
      httpFetch.mockImplementation(async (opts: any) => {
        if (opts.url.includes('/_v')) {
          return { status: 200, text: 'ok', setCookies: ['comx_cleared=1; Path=/'] }
        }
        return { status: 200, text: goodHtml, setCookies: [] }
      })
      const cleared = await ensureComxClearance('https://com-x.life/', challengeHtml, {})
      expect(cleared.resolved).toBe(true)
      expect(cleared.html).toContain('manga/x')
    })
  })
})
