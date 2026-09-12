import { Agent } from 'undici'
import { connect as netConnect } from 'net'

// Hardcoded IP pools for E-Hentai hosts, so EX stays reachable even when
// DNS is blocked (mirrors JHenTai's NetworkSetting.host2IPs). Requests go
// straight to the IP while undici still does TLS with the real hostname as
// SNI — classic domain fronting.
export const HOST2IPS: Record<string, string[]> = {
  'e-hentai.org': ['172.66.132.196', '172.66.140.62'],
  'exhentai.org': [
    '178.175.128.251', '178.175.128.252', '178.175.128.253', '178.175.128.254',
    '178.175.129.251', '178.175.129.252', '178.175.129.253', '178.175.129.254',
    '178.175.132.19', '178.175.132.20', '178.175.132.21', '178.175.132.22'
  ],
  'upld.e-hentai.org': ['95.211.208.236', '89.149.221.236'],
  'api.e-hentai.org': ['37.48.92.161', '212.7.202.51', '5.79.104.110', '37.48.81.204', '212.7.200.104'],
  'forums.e-hentai.org': ['172.66.132.196', '172.66.140.62']
}

let frontingEnabled = false
const hostIndex: Record<string, number> = {}
const unavailable: Record<string, Record<string, number>> = {}

export function setFrontingEnabled(enabled: boolean): void {
  frontingEnabled = enabled
}

export function isFrontingEnabled(): boolean {
  return frontingEnabled
}

export function supportsFronting(host: string): boolean {
  return !!HOST2IPS[host] && HOST2IPS[host].length > 0
}

function nextIP(host: string): string {
  const ips = HOST2IPS[host]
  const now = Date.now()
  let idx = hostIndex[host] ?? 0
  for (let n = 0; n < ips.length; n++) {
    const ip = ips[idx % ips.length]
    const t = unavailable[host]?.[ip]
    if (t && now - t < 5 * 60_000) {
      idx++
      continue
    }
    hostIndex[host] = idx + 1
    return ip
  }
  const fallback = ips[(hostIndex[host] ?? 0) % ips.length]
  hostIndex[host] = (hostIndex[host] ?? 0) + 1
  return fallback
}

export function markUnavailable(host: string, ip: string): void {
  unavailable[host] = unavailable[host] ?? {}
  unavailable[host][ip] = Date.now()
}

export function frontingIpFor(host: string): string {
  return nextIP(host)
}

export function buildFrontingDispatcher(host: string, ip: string): Agent {
  return new Agent({
    connect: (origin: any) => {
      const port = Number(origin?.port || (origin?.protocol === 'https:' ? 443 : 80))
      return netConnect({ host: ip, port }) as any
    }
  })
}