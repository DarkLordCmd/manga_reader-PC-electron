import { Agent } from 'undici'
import { SocksProxyAgent } from 'socks-proxy-agent'

export interface HttpFetchOptions {
  url: string
  headers?: Record<string, string>
  method?: 'GET' | 'POST'
  body?: string
  timeoutMs?: number
}

export interface HttpResult {
  status: number
  text: string
}

function normalizeSocksAddr(addr: string): string {
  return addr.trim()
    .replace(/^socks5h:\/\//, '')
    .replace(/^socks5:\/\//, '')
    .replace(/^socks4:\/\//, '')
}

export function buildSocksDispatcher(proxy: string): Agent {
  const proxyAgent = new SocksProxyAgent(`socks5h://${normalizeSocksAddr(proxy)}`)
  return new Agent({
    connect: (origin, _ctx) => {
      const req = {} as any
      const opts = {
        host: origin.hostname,
        port: Number(origin.port || (origin.protocol === 'https:' ? 443 : 80)),
        secureEndpoint: origin.protocol === 'https:'
      } as any
      return proxyAgent.connect(req, opts) as any
    }
  })
}

function buildAgent(proxy: string | undefined): Agent | undefined {
  if (!proxy || proxy.trim() === '') return undefined
  return buildSocksDispatcher(proxy)
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v
  }
  return out
}

export async function httpFetch(opts: HttpFetchOptions, proxy?: string): Promise<HttpResult> {
  const dispatcher = buildAgent(proxy)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000)
  try {
    const res = await fetch(opts.url, {
      method: opts.method ?? 'GET',
      headers: normalizeHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        ...(opts.headers ?? {})
      }),
      body: opts.body,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {})
    } as any)
    return { status: res.status, text: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

export async function httpGetText(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 20_000,
  proxy?: string
): Promise<{ status: number; text: string }> {
  return httpFetch({ url, headers, timeoutMs }, proxy)
}

export async function httpFetchBinary(
  url: string,
  headers: Record<string, string> = {},
  proxy?: string,
  timeoutMs = 30_000
): Promise<Uint8Array> {
  const dispatcher = buildAgent(proxy)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: normalizeHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        ...headers
      }),
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {})
    } as any)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

export async function httpGetJson(
  url: string,
  headers: Record<string, string> = {},
  proxy?: string,
  timeoutMs = 20_000
): Promise<unknown> {
  const r = await httpFetch({
    url,
    headers: { Accept: 'application/json', ...headers },
    timeoutMs
  }, proxy)
  if (r.status !== 200) throw new Error(`HTTP ${r.status} for ${url}`)
  return JSON.parse(r.text)
}

export async function httpPostJson(
  url: string,
  body: string,
  headers: Record<string, string> = {},
  proxy?: string,
  timeoutMs = 20_000
): Promise<unknown> {
  const r = await httpFetch({
    url,
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    timeoutMs
  }, proxy)
  if (r.status >= 300) throw new Error(`HTTP ${r.status} for ${url}`)
  return JSON.parse(r.text)
}