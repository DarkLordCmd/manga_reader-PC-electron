import { describe, it, expect } from 'vitest'
import { detectsAntiBot } from '../src/main/services/anti-bot'

describe('detectsAntiBot', () => {
  it('flags cloudflare challenge markers', () => {
    expect(detectsAntiBot(403, '<title>Just a moment...</title>')).toBe(true)
    expect(detectsAntiBot(503, 'Checking your browser before accessing')).toBe(true)
    expect(detectsAntiBot(200, 'Cf-Mitigated: challenge')).toBe(true)
  })
  it('passes normal pages', () => {
    expect(detectsAntiBot(200, '<html><body><a href="/manga/x/">ok</a></body></html>')).toBe(false)
  })
  it('flags rate limits', () => {
    expect(detectsAntiBot(429, 'too many requests')).toBe(true)
  })
})
