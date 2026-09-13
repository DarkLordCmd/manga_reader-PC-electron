import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  parseDnsServerList, setCustomDnsServers, customDnsActive,
  customDnsServers, resolveViaCustomDns, KNOWN_DNS_SERVERS
} from '../src/main/services/custom-dns'

// Intercept dns.Resolver so unit tests don't touch the network.
const mockResolve = vi.fn()
vi.mock('dns', () => {
  class Resolver {
    setServers = vi.fn()
    resolve4 = (host: string, cb: (err: any, addrs?: string[]) => void) => {
      mockResolve(host, cb)
    }
  }
  return { Resolver }
})

describe('parseDnsServerList', () => {
  it('parses a space/comma list of IPv4 addresses', () => {
    expect(parseDnsServerList('83.220.169.155, 111.88.96.50; 87.228.47.200')).toEqual([
      '83.220.169.155', '111.88.96.50', '87.228.47.200'
    ])
  })
  it('rejects junk and dedups', () => {
    expect(parseDnsServerList('abc 83.220.169.155 999.1.1.1 83.220.169.155')).toEqual(['83.220.169.155'])
    expect(parseDnsServerList('')).toEqual([])
  })
})

describe('custom-dns state', () => {
  beforeEach(() => { mockResolve.mockReset(); mockResolve.mockImplementation(() => {}) })
  it('inactive without servers', () => {
    setCustomDnsServers([])
    expect(customDnsActive()).toBe(false)
  })
  it('with servers activates and stores them', () => {
    setCustomDnsServers(['83.220.169.155'])
    expect(customDnsActive()).toBe(true)
    expect(customDnsServers()).toEqual(['83.220.169.155'])
    setCustomDnsServers([])
    expect(customDnsActive()).toBe(false)
  })
  it('KNOWN_DNS_SERVERS covers the user-provided list', () => {
    const servers = KNOWN_DNS_SERVERS.map((k) => k.server)
    expect(servers).toContain('83.220.169.155')
    expect(servers).toContain('111.88.96.50')
    expect(servers).toContain('87.228.47.200')
    expect(servers).toContain('176.99.11.77')
    expect(servers).toContain('84.21.189.133')
  })
})

describe('resolveViaCustomDns', () => {
  beforeEach(() => {
    mockResolve.mockReset()
    setCustomDnsServers(['83.220.169.155'])
  })
  it('returns a resolved ip when DNS answers', async () => {
    mockResolve.mockImplementation((_host, cb) => cb(null, ['93.184.216.34']))
    expect(await resolveViaCustomDns('example.com')).toBe('93.184.216.34')
  })
  it('returns null for onion/localhost', async () => {
    expect(await resolveViaCustomDns('exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion')).toBeNull()
    expect(await resolveViaCustomDns('localhost')).toBeNull()
  })
  it('fails fast for the FAIL window after a DNS error', async () => {
    let calls = 0
    mockResolve.mockImplementation((_h, cb) => cb(new Error('SERVFAIL')))
    expect(await resolveViaCustomDns('broken.com')).toBeNull()
    expect(await resolveViaCustomDns('broken.com')).toBeNull()
    expect(mockResolve).toHaveBeenCalledTimes(1)
  })
  it('caches a successful resolution', async () => {
    mockResolve.mockImplementation((_h, cb) => cb(null, ['1.2.3.4']))
    await resolveViaCustomDns('example.com')
    await resolveViaCustomDns('example.com')
    expect(mockResolve).toHaveBeenCalledTimes(1)
  })
  it('returns null when resolver yields no addresses', async () => {
    mockResolve.mockImplementation((_h, cb) => cb(null, []))
    expect(await resolveViaCustomDns('empty.com')).toBeNull()
  })
})
