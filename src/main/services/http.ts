import { Agent, buildConnector, fetch as undiciFetch } from 'undici'
import { connect as netConnect } from 'net'
import { isFrontingEnabled, supportsFronting, frontingIpFor, buildFrontingDispatcher, markUnavailable } from './domain-fronting'
import { isEhHost, notifyEhSetCookies } from './eh-session'
import {
  torFallbackActiveFor, markTorFallbackSuccess, markTorFallbackFailure,
  isTorFallbackBlocked, isEhTimeoutError
} from './eh-sni-fallback'
import { resolveViaCustomDns, customDnsActive } from './custom-dns'

/** Tor SOCKS address used for the automatic SNI-timeout fallback on EH hosts.
 * Injected from main (settings), empty string disables the fallback. */
let torFallbackAddr = ''
export function setTorFallbackAddr(addr: string): void {
  torFallbackAddr = addr
}
function torFallbackAvailable(): boolean {
  return torFallbackAddr.trim() !== ''
}
import { parseLimitResponse } from './eh-limits'
import { handleLimitFailure, assertNotEhBlocked, retryOnce } from './eh-limits-hook'

export interface HttpFetchOptions {
  url: string
  headers?: Record<string, string>
  method?: 'GET' | 'POST'
  body?: string
  timeoutMs?: number
  redirect?: 'follow' | 'manual'
  /** When true, an empty body from the direct path triggers a domain-fronting retry. */
  frontOnEmpty?: boolean
  /** When true, an HTTP >= 400 status on the direct path (e.g. a DNS-poisoned
   * block page or Cloudflare reject) is retried through the fallback chain
   * (custom-DNS pin, then Tor) instead of surfacing immediately. */
  allowHttpFallback?: boolean
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

/** Minimal SOCKS5 CONNECT with remote DNS (like `curl --socks5-hostname`). */
function socks5Connect(proxyHost: string, proxyPort: number, destHost: string, destPort: number, timeoutMs = 20_000): Promise<import('net').Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: proxyHost, port: proxyPort })
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`socks proxy timeout (${proxyHost}:${proxyPort})`)) }, timeoutMs)
    socket.once('error', (e) => { clearTimeout(timer); reject(e) })
    socket.once('connect', () => {
      // greeting: VER=5, NMETHODS=1, METHOD=0 (no auth)
      socket.write(Buffer.from([0x05, 0x01, 0x00]))
    })
    const fail = (msg: string): void => { clearTimeout(timer); socket.destroy(); reject(new Error(msg)) }
    const stageData = (chunk: Buffer): void => {
      if (stage === 0) {
        if (chunk.length < 2 || chunk[0] !== 0x05 || chunk[1] !== 0x00) return fail('socks: bad auth method')
        stage = 1
        // CONNECT: VER=5 CMD=1 RSV=0 ATYP=3 (domain) LEN host port
        const host = Buffer.from(destHost, 'utf-8')
        const port = Buffer.alloc(2)
        port.writeUInt16BE(destPort)
        socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]), host, port]))
      } else if (stage === 1) {
        if (chunk.length < 2 || chunk[0] !== 0x05 || chunk[1] !== 0x00) {
          return fail(`socks: connect failed (rep=${chunk[1]})`)
        }
        clearTimeout(timer)
        // Detach the handshake watcher: it would misinterpret the tunnelling
        // HTTP traffic as SOCKS frames and destroy the socket mid-request.
        socket.off('data', stageData)
        resolve(socket)
      }
    }
    let stage = 0
    socket.on('data', stageData)
  })
}

export function buildSocksDispatcher(proxy: string): Agent {
  const [proxyHost, proxyPort] = normalizeSocksAddr(proxy).split(':')
  const port = Number(proxyPort || 9150)
  const connector = buildConnector({ timeout: 30_000 })
  return new Agent({
    connect: async (opts: any, callback) => {
      try {
        const destPort = Number(opts.port || (opts.protocol === 'https:' ? 443 : 80))
        const socket = await socks5Connect(proxyHost || '127.0.0.1', port, opts.hostname, destPort)
        if (opts.protocol !== 'https:') {
          // Plain HTTP (e.g. Tor .onion mirrors): undici's TLS connector
          // asserts on httpSocket for non-TLS origins ("httpSocket can only
          // be sent on TLS update") — hand the raw tunnelled socket back.
          callback(null, socket)
          return
        }
        connector({ ...opts, httpSocket: socket }, callback)
      } catch (err) {
        callback(err as Error, null)
      }
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
        return { dispatcher: buildPinnedFrontingDispatcher(buildFrontingDispatcher(host, ip)), frontHost: host, frontIp: ip }
      }
    } catch { /* ignore */ }
  }
  // Custom-DNS pinning is only applied on the fallback path (a direct/system
  // failure was already recorded for the host) — a preemptive pin would break
  // hosts the system DNS resolves fine.
  if (customDnsActive()) {
    const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
    if (host && directFailedUntil.has(host) && Date.now() < directFailedUntil.get(host)!) {
      const ip = pinnedIpCache.get(host)
      if (ip) return { dispatcher: buildPinnedDispatcher(host, ip), frontHost: host, frontIp: ip }
    }
  }
  return { dispatcher: undefined }
}

const pinnedIpCache = new Map<string, string>()
export function rememberDirectFailureFor(host: string): void {
  directFailedUntil.set(host, Date.now() + 10 * 60_000)
}
const directFailedUntil = new Map<string, number>()

async function customDnsDispatcher(url: string): Promise<{ dispatcher?: Agent; pinned: boolean }> {
  if (!customDnsActive()) return { pinned: false }
  const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
  if (!host || !directFailedUntil.has(host)) return { pinned: false }
  try {
    const p = await resolveViaCustomDns(host)
    if (!p) return { pinned: false }
    pinnedIpCache.set(host, p)
    return { dispatcher: buildPinnedDispatcher(host, p), pinned: true }
  } catch {
    return { pinned: false }
  }
}

function buildPinnedFrontingDispatcher(h: Agent): Agent { return h }

function buildPinnedDispatcher(host: string, ip: string): Agent {
  const tlsConnector = buildConnector({ timeout: 15_000 })
  return new Agent({
    connect: async (opts: any, callback) => {
      try {
        const port = Number(opts?.port || (opts?.protocol === 'https:' ? 443 : 80))
        const socket = netConnect({ host: ip, port })
        await new Promise<void>((res, rej) => {
          socket.once('connect', () => res())
          socket.once('error', rej)
        })
        if (opts?.protocol === 'https:') {
          // TLS upgrade over the pinned TCP socket: SNI and cert validation
          // still use the real hostname, only the connection target is the
          // custom-DNS-resolved IP.
          tlsConnector({ ...opts, httpSocket: socket }, callback)
        } else {
          callback(null, socket)
        }
      } catch (err) {
        callback(err as Error, null)
      }
    }
  })
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

/** Electron sessions, one per SOCKS proxy address, for Chromium-grade fetches
 * through the proxy (browser TLS/HTTP2 fingerprint — what clears Cloudflare
 * where undici's Node-TLS handshake gets a 403). */
const proxySessions = new Map<string, Promise<any>>()
async function getElectronProxySession(addr: string): Promise<any | null> {
  try {
    const electron = require('electron')
    if (!electron?.session?.fromPartition) return null
    let pending = proxySessions.get(addr)
    if (!pending) {
      // persist:* keeps the Tor circuit pool per address across windows
      const ses = electron.session.fromPartition(`persist:http-proxy-${addr}`)
      const created = ses.setProxy({
        proxyRules: `socks5://${normalizeSocksAddr(addr)}`,
        proxyBypassRules: ''
      }).catch(() => {}).then(() => ses)
      proxySessions.set(addr, created)
      pending = created
    }
    return await pending
  } catch {
    return null
  }
}

/** When inside Electron, run a proxied request through the Chromium network
 * stack (net.fetch + proxied session). Returns null when unavailable so
 * callers fall back to the undici SOCKS dispatcher. */
async function electronProxyFetch(url: string, init: any, addr: string): Promise<Response | null> {
  try {
    const electron = require('electron')
    if (!electron?.net?.fetch) return null
    const ses = await getElectronProxySession(addr)
    if (!ses) return null
    return (await electron.net.fetch(url, { ...init, session: ses })) as unknown as Response
  } catch {
    return null
  }
}

function buildInit(opts: HttpFetchOptions): any {
  return {
    method: opts.method ?? 'GET',
    headers: normalizeHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      ...(opts.headers ?? {})
    }),
    body: opts.body,
    redirect: opts.redirect
  }
}

async function fetchWithTimeout(url: string, init: any, ms: number, dispatcher?: Agent, forceUndici = false, proxyAddr?: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  let host = ''
  try { host = new URL(url).hostname } catch { /* ignore */ }
  try {
    const full = { ...init, signal: controller.signal }
    if (forceUndici) return await fetch(url, full)
    // NOTE: do NOT route proxied requests through Electron's net.fetch:
    // its network stack hangs to the full timeout on SOCKS proxies (no
    // SOCKS support there), leaving the working undici path starved by the
    // abort already triggered.
    if (dispatcher) {
      // Always use npm undici's own fetch with a custom dispatcher: the
      // global (Node builtin) fetch's handler is not guaranteed to be
      // compatible across Node versions ("invalid onError method").
      return (await undiciFetch(url, { ...full, dispatcher } as any)) as unknown as Response
    }
    return await defaultFetch(url, full)
  } catch (e: any) {
    // Our own timeout surfaces as an abort. A hard timeout on BOTH the direct
    // and the fronting path is the signature of a TCP handshake succeeding but
    // the TLS ClientHello being dropped — classic ISP-side SNI blocking of
    // this domain. Surface a clear, actionable message instead of a bare
    // `AbortError`.
    if (e?.name === 'AbortError') {
      const e2: any = new Error(
        `Соединение с ${host || url} прервано по таймауту — сайт недоступен ` +
        '(DNS/SNI-блокировка на уровне провайдера или сеть). ' +
        'Включи Tor для этого источника в настройках или используй доступный источник.'
      )
      e2.ehSniTimeout = true
      e2.host = host
      throw e2
    }
    // undici wraps every transport failure in a generic `TypeError: fetch
    // failed` and hides the real reason in `e.cause` (SOCKS handshake result,
    // ECONNREFUSED on the Tor port, DNS failure, …). Unwrap it so the user
    // sees an actionable message instead of a bare "fetch failed".
    const cause = e?.cause
    const cmsg = String(cause?.message ?? cause ?? '')
    if (String(e?.message ?? '') === 'fetch failed' && cmsg) {
      const l = cmsg.toLowerCase()
      let msg: string
      const addr = l.match(/\d{1,3}(?:\.\d{1,3}){3}:\d+/)?.[0] ?? '127.0.0.1:9150'
      if (l.includes('econnrefused') || l.includes('socks proxy timeout')) {
        msg = `Не удалось подключиться к Tor SOCKS (${addr}) — проверь, что Tor запущен и адрес совпадает с настройками.`
      } else if (l.includes('socks:')) {
        msg = `Tor не смог соединиться с ${host || url} (${cmsg}) — зеркало может быть недоступно, проверь Tor-сеть или смени адрес зеркала в настройках.`
      } else {
        msg = `Сетевая ошибка при запросе ${host || url}: ${cmsg}`
      }
      const e2: any = new Error(msg)
      e2.isNetworkFailure = true
      throw e2
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Performs one request.
 * - Plain proxy (Tor): goes straight through the proxy dispatcher.
 * - Domain-fronting mode: tries the direct path first (fast when the domain
 *   resolves, which is the common case), and only falls back to fronting
 *   (undici → hardcoded IP) when the direct attempt fails. Failed fronting
 *   IPs are marked unavailable for a while.
 * - Otherwise: direct path only (Chromium net.fetch, undici outside Electron).
 */
async function performFetch(
  opts: HttpFetchOptions,
  dispatcher: Agent | undefined,
  frontHost: string | undefined,
  frontIp: string | undefined,
  proxyAddr?: string
): Promise<{ res: Response; bodyText: string | null }> {
  const baseTimeout = opts.timeoutMs ?? 30_000
  const init = buildInit(opts)
  // `redirect:'manual'` must stay on undici: Chromium returns an opaque
  // redirect response (status 0, no headers), so Set-Cookie would be lost.
  // Same when a custom-DNS pin is active: Chromium resolves DNS itself and
  // ignores our dispatcher.
  const forceUndici = opts.redirect === 'manual' || !!(
    customDnsActive() && (() => { try { return pinnedIpCache.has(new URL(opts.url).hostname) } catch { return false } })()
  )
  const frontOnEmpty = opts.frontOnEmpty === true

  if (!dispatcher || !frontHost) {
    const res = await fetchWithTimeout(opts.url, init, baseTimeout, dispatcher, forceUndici, proxyAddr)
    return { res, bodyText: null }
  }

  // Domain-fronting mode: direct first, fronting as fallback.
  let directEmpty: { res: Response; text: string } | null = null
  if (!forceUndici) {
    try {
      const res = await fetchWithTimeout(opts.url, init, Math.min(baseTimeout, 12_000), dispatcher, forceUndici, proxyAddr)
      if (!frontOnEmpty) return { res, bodyText: null }
      const text = await res.text()
      if (text.trim().length > 0) return { res, bodyText: text }
      // Empty body (e.g. ExHentai sad panda / IP rate-limit) → try fronting.
      directEmpty = { res, text }
    } catch { /* direct failed, fall through to fronting */ }
  }

  try {
    const res = await fetchWithTimeout(opts.url, init, 10_000, dispatcher, forceUndici, proxyAddr)
    return { res, bodyText: null }
  } catch (e) {
    markUnavailable(frontHost, frontIp!)
    if (directEmpty) {
      // Fronting unreachable — surface the direct (empty) result so the
      // caller reports the accurate sad-panda/rate-limit error instead of a
      // network timeout.
      return { res: directEmpty.res, bodyText: directEmpty.text }
    }
    throw e
  }
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

/** Hosts eligible for the automatic Tor fallback on network failures. */
function isEhSiteHost(host: string): boolean {
  return host.includes('exhentai') || host.includes('e-hentai.org')
}

/**
 * Network-level failures that are worth a Tor retry: our own timeout aborts
 * (tagged), and transport errors (net::ERR_*, node fetch failures, socket
 * resets, DNS failures). Deliberately NOT: structured business errors
 * (ehBlocked, layout-changed) and plain HTTP <status> errors.
 */
function isNetworkLevelError(e: unknown): boolean {
  if (isEhTimeoutError(e)) return true
  const err = e as any
  if (!err || typeof err !== 'object') return false
  // explicit tag set by the fetch-failed unwrapping above
  if (err.isNetworkFailure === true) return true
  if (err.code === 'layout-changed' || err.ehBlocked !== undefined) return false
  const msg = String(err.message ?? '')
  if (msg.startsWith('HTTP ')) return false
  const m = msg.toLowerCase()
  return [
    'net::err', 'fetch failed', 'und_err', 'econnreset', 'econnrefused',
    'enotfound', 'socket hang up', 'eai_again', 'etimedout', 'receiver error'
  ].some((s) => m.includes(s))
}

/**
 * Runs `run` once; on a network-level failure (DNS/SNI block or dead path)
 * with no explicit proxy, retries once through the fallback Tor SOCKS
 * dispatcher. Cooldown state (eh-sni-fallback) prevents repeated 20-30s
 * timeouts: after a success later requests go straight through Tor; after a
 * failure the fallback is parked for 10 minutes.
 */
async function withSniFallback<T>(url: string, requestProxy: string | undefined, run: (proxy: string | undefined) => Promise<T>): Promise<T> {
  const host = hostnameOf(url)
  let proxied = requestProxy
  if (!proxied && torFallbackAvailable() && !host.includes('.onion') && torFallbackActiveFor(host)) {
    proxied = torFallbackAddr
  }
  try {
    return await run(proxied)
  } catch (e) {
    const retryable = isNetworkLevelError(e) || (e as any)?.allowHttpFallback === true
    const canFallback =
      !proxied && torFallbackAvailable() && !isTorFallbackBlocked(host) &&
      retryable &&
      (isEhSiteHost(host) || !['', 'localhost', '127.0.0.1'].includes(host))
    if (!canFallback) throw e
    // 1st: custom-DNS pin (fixes DNS-poisoning), 2nd: Tor (fixes everything else).
    if (customDnsActive()) {
      rememberDirectFailureFor(host)
      try {
        const r = await run(proxied) // buildDispatcherFor consults pin cache now
        pinnedOkFor(host)
        return r
      } catch { /* pin failed, fall through to tor */ }
    }
    try {
      const r = await run(torFallbackAddr)
      markTorFallbackSuccess(host)
      return r
    } catch {
      markTorFallbackFailure(host)
      throw e
    }
  }
}

function pinnedOkFor(host: string): void {
  // Successful pin — keep routing pinned for the TTL (10 min), so the dead
  // system path isn't retried every request.
  directFailedUntil.set(host, Date.now() + 10 * 60_000)
}

export async function httpFetch(opts: HttpFetchOptions, proxy?: string): Promise<HttpResult> {
  return retryOnce(async () => {
    return await withSniFallback(opts.url, proxy, async (p) => {
      assertNotEhBlocked(opts.url)
      await customDnsDispatcher(opts.url)
      const { dispatcher, frontHost, frontIp } = buildDispatcherFor(opts.url, p)
      const { res, bodyText } = await performFetch(opts, dispatcher, frontHost, frontIp, p)
      const setCookies = extractSetCookies(res)
      if (setCookies.length > 0) {
        try {
          const host = new URL(opts.url).hostname
          if (isEhHost(host)) notifyEhSetCookies(host, setCookies)
        } catch { /* ignore */ }
      }
      // Body is read exactly once here; the EH limit check below sees the same text.
      const text = bodyText ?? await res.text()
      const hostLower = hostnameOf(opts.url)
      if (isEhHost(hostLower) || hostLower.includes('exhentai') || hostLower.includes('e-hentai.org')) {
        const lim = parseLimitResponse(text.slice(0, 4000))
        if (lim.kind) throw handleLimitFailure(lim.kind, lim.resetAfterSec)
      }
      // Opt-in HTTP fallback (nhentai et al.): a 4xx/5xx on the direct path
      // may mean a DNS-poisoned block page or a Cloudflare reject — let
      // withSniFallback retry via custom-DNS pin, then Tor.
      if (opts.allowHttpFallback === true && res.status >= 400) {
        const e: any = new Error(`HTTP ${res.status} for ${opts.url}`)
        e.allowHttpFallback = true
        throw e
      }
      return { status: res.status, text, setCookies }
    })
  })
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
  timeoutMs = 30_000,
  allowHttpFallback = false
): Promise<Uint8Array> {
  return await withSniFallback(url, proxy, async (p) => {
    assertNotEhBlocked(url)
    await customDnsDispatcher(url)
    const { dispatcher, frontHost, frontIp } = buildDispatcherFor(url, p)
    const { res } = await performFetch({ url, headers, timeoutMs, method: 'GET', allowHttpFallback }, dispatcher, frontHost, frontIp, p)
    if (!res.ok) {
      const e: any = new Error(`HTTP ${res.status} for ${url}`)
      if (allowHttpFallback) e.allowHttpFallback = true
      throw e
    }
    // Body is read exactly once; limit pages arrive as text/html instead of an image.
    const buf = Buffer.from(await res.arrayBuffer())
    const hostLower = hostnameOf(url)
    const ct = res.headers.get('content-type') ?? ''
    if ((isEhHost(hostLower) || hostLower.includes('exhentai') || hostLower.includes('e-hentai.org')) && ct.includes('text/html')) {
      const lim = parseLimitResponse(buf.slice(0, 4000).toString('utf-8'))
      if (lim.kind) throw handleLimitFailure(lim.kind, lim.resetAfterSec)
    }
    return new Uint8Array(buf)
  })
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