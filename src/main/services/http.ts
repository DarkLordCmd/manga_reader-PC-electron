import { Agent } from 'undici'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { isFrontingEnabled, supportsFronting, frontingIpFor, buildFrontingDispatcher, markUnavailable } from './domain-fronting'
import { isEhHost, notifyEhSetCookies } from './eh-session'

export interface HttpFetchOptions {
  url: string
  headers?: Record<string, string>
  method?: 'GET' | 'POST'
  body?: string
  timeoutMs?: number
  redirect?: 'follow' | 'manual'
}

export interface HttpResult {
  status: number
  text: string
  setCookies: string[]
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

function buildDispatcherFor(url: string, proxy?: string): { dispatcher: Agent | undefined; frontHost?: string; frontIp?: string } {
  if (proxy && proxy.trim() !== '') {
    return { dispatcher: buildSocksDispatcher(proxy) }
  }
  if (isFrontingEnabled()) {
    try {
      const host = new URL(url).hostname
      if (supportsFronting(host)) {
        const ip = frontingIpFor(host)
        return { dispatcher: buildFrontingDispatcher(host, ip), frontHost: host, frontIp: ip }
      }
    } catch { /* ignore */ }
  }
  return { dispatcher: undefined }
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v
  }
  return out
}

/**
 * When no explicit proxy / domain-fronting dispatcher is needed, run the
 * request through Chromium's network stack (`net.fetch`) instead of undici:
 * it has a browser-grade TLS fingerprint, honors the system proxy, HTTP/2,
 * and passes Cloudflare — exactly how JHenTai's native HTTP behaves. Falls
 * back to undici's `fetch` outside Electron (e.g. unit tests).
 */
async function defaultFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron')
    if (electron?.net?.fetch) return await electron.net.fetch(url, init)
  } catch { /* not inside Electron main */ }
  return fetch(url, init)
}

function extractSetCookies(res: Response): string[] {
  try {
    const getSetCookie = (res.headers as any).getSetCookie
    return typeof getSetCookie === 'function'
      ? (getSetCookie.call(res.headers) ?? [])
      : ((res.headers.get('set-cookie') ?? '').split(/,(?=\s*[^=\s]+=)/).map((s) => s.trim()).filter(Boolean))
  } catch {
    return []
  }
}

export async function httpFetch(opts: HttpFetchOptions, proxy?: string): Promise<HttpResult> {
  const { dispatcher, frontHost, frontIp } = buildDispatcherFor(opts.url, proxy)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000)
  try {
    const headers = normalizeHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      ...(opts.headers ?? {})
    })
    const init = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body,
      signal: controller.signal,
      redirect: opts.redirect
    } as any
    // `redirect:'manual'` must stay on undici: Chromium returns an opaque
    // redirect response (status 0, no headers), so Set-Cookie would be lost.
    const res = (dispatcher || opts.redirect === 'manual')
      ? await fetch(opts.url, { ...init, dispatcher } as any)
      : await defaultFetch(opts.url, init)
    const setCookies = extractSetCookies(res)
    if (setCookies.length > 0) {
      try {
        const host = new URL(opts.url).hostname
        if (isEhHost(host)) notifyEhSetCookies(host, setCookies)
      } catch { /* ignore */ }
    }
    return { status: res.status, text: await res.text(), setCookies }
  } catch (e) {
    if (frontHost && frontIp) markUnavailable(frontHost, frontIp)
    throw e
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
  const { dispatcher, frontHost, frontIp } = buildDispatcherFor(url, proxy)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const init = {
      method: 'GET',
      headers: normalizeHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        ...headers
      }),
      signal: controller.signal
    } as any
    const res = dispatcher
      ? await fetch(url, { ...init, dispatcher } as any)
      : await defaultFetch(url, init)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  } catch (e) {
    if (frontHost && frontIp) markUnavailable(frontHost, frontIp)
    throw e
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