import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  supportsFronting, frontingIpFor, markUnavailable, setFrontingEnabled, isFrontingEnabled,
  HOST2IPS
} from '../src/main/services/domain-fronting'

beforeEach(() => {
  setFrontingEnabled(false)
})

afterEach(() => {
  setFrontingEnabled(false)
})

describe('domain-fronting', () => {
  it('knows the E-Hentai hosts', () => {
    expect(supportsFronting('exhentai.org')).toBe(true)
    expect(supportsFronting('e-hentai.org')).toBe(true)
    expect(supportsFronting('example.com')).toBe(false)
  })

  it('round-robins through IPs and marks unavailable ones', () => {
    const ips = HOST2IPS['exhentai.org']
    const first = frontingIpFor('exhentai.org')
    const second = frontingIpFor('exhentai.org')
    expect(ips).toContain(first)
    expect(ips).toContain(second)
    expect(first).not.toBe(second)
  })

  it('skips a recently unavailable IP', () => {
    const ips = HOST2IPS['e-hentai.org']
    markUnavailable('e-hentai.org', ips[0])
    // The next pick must not be the just-marked IP (unless the pool is 1).
    if (ips.length > 1) {
      const picked = frontingIpFor('e-hentai.org')
      expect(picked).not.toBe(ips[0])
    }
  })

  it('toggles the global flag', () => {
    expect(isFrontingEnabled()).toBe(false)
    setFrontingEnabled(true)
    expect(isFrontingEnabled()).toBe(true)
  })
})