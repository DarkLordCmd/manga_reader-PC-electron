import { Resolver } from 'dns'

/** Known blocker-circumvention DNS servers (user-provided list). */
export const KNOWN_DNS_SERVERS: { name: string; server: string }[] = [
  { name: 'ComssDNS', server: '83.220.169.155' },
  { name: 'XboxDNS', server: '111.88.96.50' },
  { name: 'XboxDNS v2', server: '87.228.47.200' },
  { name: 'XboxDNS old', server: '176.99.11.77' },
  { name: 'MalwDNS', server: '84.21.189.133' }
]

export const AIR_DNS_TEST_HOST = 'ya.ru'

export function parseDnsServerList(raw: string): string[] {
  const oct = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)'
  const re = new RegExp(`^${oct}(\\.${oct}){3}$`)
  return [...new Set(
    (raw ?? '')
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => re.test(s))
  )]
}

interface CacheEntry {
  ips: string[]
  expiresAt: number
  failUntil: number
}

const TTL_MS = 10 * 60_000
const FAIL_MS = 2 * 60_000
const cache = new Map<string, CacheEntry>()

let servers: string[] = []
let resolverCounter = 0

export function setCustomDnsServers(list: string[]): void {
  servers = list
  cache.clear()
}

export function customDnsActive(): boolean {
  return servers.length > 0
}

export function customDnsServers(): string[] {
  return [...servers]
}

/**
 * Resolves `host` through the configured custom DNS servers (plain UDP DNS
 * queries, bypassing the ISP's poisoned resolver). Returns a rotating IP or
 * null when the custom DNS path isn't usable.
 */
export async function resolveViaCustomDns(host: string): Promise<string | null> {
  if (servers.length === 0 || !host || host.includes('.onion')) return null
  if (host === 'localhost' || host === '127.0.0.1') return null
  let entry = cache.get(host)
  const now = Date.now()
  if (entry && now < entry.failUntil) return null
  if (!entry || now >= entry.expiresAt) {
    try {
      const resolver = new Resolver({ timeout: 4000, tries: 2 })
      // round-robin across the configured servers so bursts rotate them too
      const server = servers[(resolverCounter++) % servers.length]
      resolver.setServers([server])
      const ips = await new Promise<string[]>((resolve, reject) => {
        resolver.resolve4(host, (err, addrs) => {
          if (err) reject(err)
          else resolve(addrs ?? [])
        })
      })
      if (ips.length === 0) {
        entry = { ips: [], expiresAt: now + TTL_MS, failUntil: now + FAIL_MS }
        cache.set(host, entry)
        return null
      }
      entry = { ips, expiresAt: now + TTL_MS, failUntil: 0 }
      cache.set(host, entry)
    } catch {
      entry = { ips: [], expiresAt: now + TTL_MS, failUntil: now + FAIL_MS }
      cache.set(host, entry)
      return null
    }
  }
  const ips = entry.ips
  if (ips.length === 0) return null
  const idx = Math.floor(Date.now() / 1000) % ips.length
  return ips[idx]
}

/**
 * Pure JSON parsing helper for the DNS checks IPC: annotates each server with
 * whether it answered correctly for a test host.
 */
export async function checkCustomDns(host: string): Promise<{ server: string; ok: boolean; ip: string | null; ms: number }[]> {
  const out: { server: string; ok: boolean; ip: string | null; ms: number }[] = []
  for (const server of servers) {
    const start = Date.now()
    try {
      const resolver = new Resolver()
      resolver.setServers([server])
      const ip = await new Promise<string | null>((resolve) => {
        resolver.resolve4(host, (err, addrs) => resolve(err ? null : addrs?.[0] ?? null))
      })
      out.push({ server, ok: ip !== null, ip, ms: Date.now() - start })
    } catch {
      out.push({ server, ok: false, ip: null, ms: Date.now() - start })
    }
  }
  return out
}
