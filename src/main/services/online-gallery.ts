import { randomUUID } from 'crypto'
import { buildSocksDispatcher } from './http'
import { withMirror } from './lib-mirror'
import { fetchHtmlSmart } from './fetch-html'

export const MAX_CONCURRENT = 10
export const LOAD_AHEAD = 40
export const KEEP_BEHIND = 4

/** Global pacing for E-Hentai hosts: keeps the burst under the ban
 * threshold while letting the 10-wide queue stay busy on other hosts. */
const EH_HOST = /exhentai|e-hentai\.org/
let ehNextAt = 0
function ehGate(): Promise<void> {
  const now = Date.now()
  const start = Math.max(now, ehNextAt)
  ehNextAt = start + 250
  return new Promise((r) => setTimeout(r, Math.max(0, start - now)))
}

interface Entry {
  index: number
  url: string
  /** the /s/ viewer page the image URL was resolved from (EH galleries) */
  viewerUrl: string | null
  buffer: Buffer | null
  state: 'idle' | 'loading' | 'done' | 'failed'
  error: string | null
  promise: Promise<void> | null
  failedAt: number | null
}

interface OnlineGallery {
  title: string
  entries: Entry[]
  position: number
  proxy?: string
}

const galleries = new Map<string, OnlineGallery>()
let inFlight = 0
const queue: (() => void)[] = []

function pump(): void {
  while (inFlight < MAX_CONCURRENT && queue.length > 0) {
    const fn = queue.shift()!
    inFlight++
    fn()
  }
}

export function createOnlineGallery(title: string, urls: string[], proxy?: string): string {
  const gid = randomUUID()
  galleries.set(gid, {
    title,
    entries: urls.map((url, index) => ({ index, url, buffer: null, state: 'idle', error: null, promise: null, failedAt: null, viewerUrl: (url.includes('exhentai') || url.includes('e-hentai.org')) && /\/s\//.test(url) ? url : null })),
    position: 0,
    proxy
  })
  return gid
}

export function setReadingPosition(gid: string, index: number): void {
  const g = galleries.get(gid)
  if (!g) return
  g.position = index
  for (const e of g.entries) {
    if (e.state === 'done' && e.index < index - KEEP_BEHIND) {
      e.buffer = null
      e.state = 'idle'
    }
  }
}

/** Plain HTTP fetch of an EH viewer page through the gallery dispatcher.
 * Returns null when the fast path fails (caller falls back to fetchHtmlSmart). */
async function fetchViewerHtml(url: string, proxy: string | undefined, cookie: string | undefined): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const dispatch = proxy ? { dispatcher: buildSocksDispatcher(proxy) } : {}
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html,application/xhtml+xml', ...(cookie ? { Cookie: cookie } : {}) },
        signal: controller.signal,
        ...dispatch
      } as any)
      if (!res.ok) return null
      const text = await res.text()
      if (/Cloudflare|Just a moment|checking your browser/i.test(text.slice(0, 600))) return null
      return text
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

/** Downloads one page image with retries: mirror/webcore transient glitches,
 * 429/5xx and connection resets all deserve another attempt with backoff.
 * Text-HTML responses (rate-limit walls, plastic pages) end the loop early. */
async function fetchImageWithRetry(
  g: OnlineGallery,
  fetchUrl: string,
  headers: Record<string, string>
): Promise<Buffer> {
  const ATTEMPTS = 3
  let lastErr: unknown
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      try {
        const dispatch = g.proxy ? { dispatcher: buildSocksDispatcher(g.proxy) } : {}
        const res = await fetch(fetchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...headers },
          signal: controller.signal,
          ...dispatch
        } as any)
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${fetchUrl}`)
        // E-Hentai/ExHentai sometimes answers image requests with an HTML
        // "image limit exceeded" page — detect it so the page isn't stored.
        if (EH_HOST.test(fetchUrl) || fetchUrl.includes('ehgt.org')) {
          const ct = res.headers.get('content-type') ?? ''
          if (ct.includes('text/html') || ct.includes('application/xhtml')) {
            const buf = Buffer.from(await res.arrayBuffer())
            const head = buf.slice(0, 400).toString('utf-8')
            if (head.startsWith('You have exceeded your image') || head.includes('exceeded your image viewing limits')) {
              throw new LimitError('Превышен лимит просмотра изображений на E-Hentai.')
            }
            throw new Error(`E-Hentai вернул HTML вместо изображения (${fetchUrl})`)
          }
        }
        return Buffer.from(await res.arrayBuffer())
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      lastErr = err
      if (err instanceof LimitError) throw err // rate-limit walls don't benefit from retrying
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

class LimitError extends Error {}

async function loadOne(g: OnlineGallery, e: Entry, headers: Record<string, string>): Promise<void> {
    try {
      // E-Hentai/ExHentai pageUrls are /s/ viewer pages, not images: fetch
      // the viewer HTML, extract img#img, then download the image. The
      // resolved URL is written back so eviction/re-requests skip the extra
      // page (until the signed CDN URL expires).
      const isEh = EH_HOST.test(e.url)
      const isEhViewer = isEh && /\/s\/[0-9a-z]+\/\d+-\d+/.test(e.url)
      let fetchUrl = withMirror(e.url)
      if (isEh) await ehGate()
      if (isEhViewer) {
        // Fast path first: plain HTTP fetch via the gallery dispatcher. The
        // browser fallback (fetchHtmlSmart) only for a real anti-bot wall,
        // and up to 2 attempts when the fast one cannot resolve the image.
        let img: string | null = null
        for (let va = 0; va < 2 && !img; va++) {
          const vh = await fetchViewerHtml(e.url, g.proxy, headers.Cookie)
          const viewerHtml = vh !== null ? vh : await fetchHtmlSmart(e.url, { timeoutMs: 45_000, proxy: g.proxy, cookieHeader: headers.Cookie })
          if (/exceeded your image viewing limits|sad panda/i.test(viewerHtml)) {
            throw new LimitError('Превышен лимит просмотра изображений на E-Hentai.')
          }
          const m = viewerHtml.match(/img id="img"[^>]*\ssrc="([^"]+)"/) ?? viewerHtml.match(/id="img"[^>]*src="([^"]+)"/)
          if (!m) {
            if (va < 1) { await new Promise((r) => setTimeout(r, 1200)); continue }
            throw new Error('Не удалось распознать страницу изображения EH (/s/), сайт мог изменить вёрстку.')
          }
          img = new URL(m[1], e.url).toString()
        }
        if (!img) throw new Error('Не удалось распознать страницу изображения EH (/s/), сайт мог изменить вёрстку.')
        e.url = img
        fetchUrl = img
      }
      e.buffer = await fetchImageWithRetry(g, fetchUrl, headers)
      e.state = 'done'
  } catch (err: any) {
    e.error = err?.message ?? String(err)
    e.state = 'failed'
    e.failedAt = Date.now()
  } finally {
    inFlight--
    pump()
  }
}

function settle(entry: Entry): Promise<Buffer | null> {
  return entry.promise!.then(() => {
    if (entry.state === 'done') return entry.buffer
    throw new Error(entry.error ?? 'failed')
  })
}

export function requestPage(gid: string, index: number, headers: Record<string, string>): Promise<Buffer | null> {
  const g = galleries.get(gid)
  if (!g) throw new Error('Gallery not found')
  const e = g.entries[index]
  if (!e) throw new Error(`Page ${index} out of range`)
  if (e.state === 'done') return Promise.resolve(e.buffer)
  if (e.state === 'failed') {
    // Transient failures (network hiccup, rate limit) used to be permanent —
    // the renderer's retry re-request now gets a fresh load with backoff.
    const since = e.failedAt ? Date.now() - e.failedAt : Infinity
    if (since < 3000) return Promise.reject(new Error(e.error ?? 'failed'))
    // Re-resolve EH entries from their /s/ viewer page (the signed image URL
    // may have expired after eviction).
    if (e.viewerUrl && e.url !== e.viewerUrl) e.url = e.viewerUrl
    e.state = 'idle'
    e.promise = null
  }
  if (e.promise) return settle(e)

  const start = Math.max(0, g.position - KEEP_BEHIND)
  const end = Math.min(g.entries.length, g.position + LOAD_AHEAD + 1)
  const toWarm = g.entries.slice(start, end).filter((x) => x.state === 'idle' && x.promise === null)

  e.promise = new Promise<void>((resolvePromise) => {
    queue.push(() => { void loadOne(g, e, headers).then(resolvePromise) })
  })
  for (const w of toWarm) {
    if (w === e || w.promise) continue
    w.promise = new Promise<void>((rp) => {
      queue.push(() => { void loadOne(g, w, headers).then(rp) })
    })
  }
  pump()
  return settle(e)
}

export function getGalleryPages(gid: string): { title: string; pageCount: number } | null {
  const g = galleries.get(gid)
  return g ? { title: g.title, pageCount: g.entries.length } : null
}

export function pageReady(gid: string, index: number): boolean {
  const g = galleries.get(gid)
  return !!g && g.entries[index]?.state === 'done'
}