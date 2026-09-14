import { webcrypto } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { httpFetch } from './http'

/** com-x.life runs a custom PoW anti-bot (token → SHA256(token:nonce) with
 *  prefix "00" → POST /_v → clearance cookie). This module emulates a normal
 *  browser client for it in pure Node. */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36'
const POW_PREFIX = '00'
const MAX_NONCE = 2_000_000

/**
 * Interactive-compat replica of com-x.life's inline challenge: find the
 * smallest nonce such that sha256("{token}:{nonce}") starts with "00".
 * Matches the site's modern mode; legacy fallback sends plausible counters.
 */
export async function solvePow(token: string): Promise<{ pow_nonce: string; pow_hash: string; workTime: string; iterations: string } | null> {
  const enc = new TextEncoder()
  for (let nonce = 0; nonce < MAX_NONCE; nonce++) {
    const hash = await webcrypto.subtle.digest('SHA-256', enc.encode(`${token}:${nonce}`))
    const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
    if (hex.startsWith(POW_PREFIX)) {
      return {
        pow_nonce: String(nonce),
        pow_hash: hex,
        workTime: '300',
        iterations: String(Math.max(nonce * 50, 1000))
      }
    }
  }
  return null
}

export interface ChallengeInfo {
  token: string
  targetUrl: string
}

export function parseChallenge(html: string): ChallengeInfo | null {
  const token = html.match(/token:\s*"([^"]+)"/)?.[1] ?? html.match(/var token = "([^"]+)"/)?.[1]
  const target = html.match(/targetUrl = decodeURIComponent\("([^"]+)"\)/)?.[1]
  if (!token || !target) return null
  return { token, targetUrl: decodeURIComponent(target) }
}

/** Builds the same form body the site's sendResult() would POST to /_v. */
export function buildValidationBody(t: ChallengeInfo, pow: { pow_nonce: string; pow_hash: string; workTime: string; iterations: string } | null): string {
  const parts: string[] = [
    `token=${encodeURIComponent(t.token)}`,
    `mode=modern`,
    `workTime=${pow?.workTime ?? '600'}`,
    `iterations=${pow?.iterations ?? '12000'}`
  ]
  if (pow?.pow_nonce) parts.push(`pow_nonce=${encodeURIComponent(pow.pow_nonce)}`)
  if (pow?.pow_hash) parts.push(`pow_hash=${encodeURIComponent(pow.pow_hash)}`)
  parts.push('webdriver=0', 'touch=0', 'screen_w=1920', 'screen_h=1080', 'screen_cd=24')
  parts.push(`tz=${encodeURIComponent('-180')}`, 'dpr=1', 'cdp=0', 'cdpf=')
  return parts.join('&')
}

export function isChallenge(html: string): boolean {
  // the site embeds token inside `var p = { token: "…" }` (or as `var token =`
  // in an older script revision) — both carry the sendResult() verifier.
  return typeof html === 'string' &&
    html.includes('sendResult') &&
    (/token:\s*"/.test(html) || html.includes('var token ='))
}

interface CookieStore { [host: string]: string }
let cookieStore: CookieStore = {}
let cookieStorePath: string | null = null

export function initCookieStore(userDataDir: string): void {
  cookieStorePath = join(userDataDir, 'comx-cookie.json')
  try {
    if (existsSync(cookieStorePath)) cookieStore = JSON.parse(readFileSync(cookieStorePath, 'utf-8')) as CookieStore
  } catch { cookieStore = {} }
}

function saveCookieStore(): void {
  if (!cookieStorePath) return
  try {
    writeFileSync(cookieStorePath, JSON.stringify(cookieStore, null, 2))
  } catch { /* ignore */ }
}

export function cookieForHost(host: string): string {
  return cookieStore[host] ?? ''
}

/** Merges Set-Cookie values for a host (later values WIN per cookie-name). */
export function storeCookies(host: string, setCookies: string[]): void {
  const pairs: string[] = [(cookieStore[host] ?? '').split('; ').filter(Boolean)].flat()
  for (const raw of setCookies) {
    const pair = raw.split(';')[0]
    const name = pair.split('=')[0]?.trim()
    if (!name) continue
    const idx = pairs.findIndex((p) => p.split('=')[0]?.trim() === name)
    if (idx >= 0) pairs[idx] = pair
    else pairs.push(pair)
  }
  cookieStore[host] = pairs.join('; ')
  saveCookieStore()
}

function headersFor(url: string): Record<string, string> {
  const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
  const cookie = cookieStore[host]
  return {
    'User-Agent': UA,
    Referer: url,
    Accept: 'text/html,application/xhtml+xml',
    ...(cookie ? { Cookie: cookie } : {})
  }
}

/**
 * Ensures a challenge-free response for `target` on com-x.life: if the HTML
 * is the site's PoW challenge, solves it (POST /_v) and refetches. Returns
 * the final HTML; stores cookies for subsequent requests.
 */
export async function ensureComxClearance(
  target: string,
  html: string,
  opts: { proxy?: string; cookieHeader?: string } = {}
): Promise<{ html: string; resolved: boolean }> {
  if (!isChallenge(html)) return { html, resolved: false }
  const challenge = parseChallenge(html)
  if (!challenge) return { html, resolved: false }
  const host = new URL(target).hostname

  // challenge GET also sets cookies — pick them up first.
  const first = await httpFetch({ url: target, headers: headersFor(target), timeoutMs: 20_000 }, opts.proxy)
  storeCookies(host, first.setCookies)

  const pow = await solvePow(challenge.token)
  const body = buildValidationBody(challenge, pow)

  const v = await httpFetch({
    url: 'https://com-x.life/_v',
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Origin: 'https://com-x.life',
      Referer: 'https://com-x.life/',
      ...(cookieStore[host] ? { Cookie: cookieStore[host] } : {})
    },
    timeoutMs: 20_000
  }, opts.proxy)
  storeCookies(host, v.setCookies)

  const r = await httpFetch({ url: target, headers: headersFor(target), timeoutMs: 20_000 }, opts.proxy)
  storeCookies(host, r.setCookies)
  return { html: r.text, resolved: r.status === 200 && !isChallenge(r.text) }
}

/** Fetches `url` text with 404-tolerant behaviour (com-x serves its PoW
 *  challenge as a 404 page, sometimes mirrors a plain 404 to blocked cookies).
 *  Solving flow: direct GET → challenge? → solve. If a plain 404 arrives and
 *  no clearance cookie exists yet, bootstrap via the root page (which serves
 *  the real challenge), then refetch. */
export async function comxFetchText(
  url: string,
  opts: { proxy?: string; timeoutMs?: number } = {}
): Promise<string> {
  const r = await httpFetch({ url, headers: headersFor(url), timeoutMs: opts.timeoutMs ?? 20_000 }, opts.proxy)
  storeCookies(new URL(url).hostname, r.setCookies)
  if (isChallenge(r.text)) {
    const cleared = await ensureComxClearance(url, r.text, opts)
    if (cleared.resolved) return cleared.html
    if (r.status >= 400 && r.status < 500) throw new Error(`HTTP ${r.status} for ${url}`)
    return cleared.html
  }
  if (r.status === 404 && !cookieForHost(new URL(url).hostname)) {
    // no clearance cookie and a plain 404 — the root usually carries the
    // challenge; warm up there, then retry the target once.
    const root = await httpFetch({ url: 'https://com-x.life/', headers: headersFor('https://com-x.life/'), timeoutMs: opts.timeoutMs ?? 20_000 }, opts.proxy)
    if (isChallenge(root.text)) {
      const cleared = await ensureComxClearance('https://com-x.life/', root.text, opts)
      if (cleared.resolved) {
        const r2 = await httpFetch({ url, headers: headersFor(url), timeoutMs: opts.timeoutMs ?? 20_000 }, opts.proxy)
        storeCookies(new URL(url).hostname, r2.setCookies)
        if (!isChallenge(r2.text) && r2.status < 400) return r2.text
      }
    }
    throw new Error(`HTTP 404 for ${url}`)
  }
  if (r.status >= 400 && r.status < 500) throw new Error(`HTTP ${r.status} for ${url}`)
  return r.text
}

/** Wrapper used by sources/simple-sites.ts and resolve-gallery: if the first
 * attempt hits the challenge page, solves it once and re-fetches. */
export async function comxSmartFetch(
  url: string,
  fetcher: () => Promise<string>,
  opts: { proxy?: string; cookieHeader?: string } = {}
): Promise<string> {
  const html = await fetcher()
  if (!isChallenge(html)) return html
  const cleared = await ensureComxClearance(url, html, opts)
  return cleared.resolved ? cleared.html : html
}
