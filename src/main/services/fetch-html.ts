import { httpFetch } from './http'
import { fetchHtmlViaBrowser, detectsAntiBot } from './browser-fetch'

export interface FetchHtmlOptions {
  proxy?: string
  cookieHeader?: string
  timeoutMs?: number
  /** Internal test handle: disables the browser fallback. */
  useBrowser?: boolean
}

export async function fetchHtmlSmart(url: string, opts: FetchHtmlOptions = {}): Promise<string> {
  const headers: Record<string, string> = {
    Referer: url,
    Accept: 'text/html,application/xhtml+xml',
    ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {})
  }
  const r = await httpFetch({ url, headers, timeoutMs: opts.timeoutMs }, opts.proxy)
  if (!detectsAntiBot(r.status, r.text)) return r.text
  if (opts.useBrowser === false) throw new Error(`HTTP ${r.status}: анти-бот блокирует запрос`)
  return await fetchHtmlViaBrowser(url, { proxy: opts.proxy, timeoutMs: opts.timeoutMs })
}
