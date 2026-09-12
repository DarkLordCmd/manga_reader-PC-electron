import { randomUUID } from 'crypto'
import { buildSocksDispatcher } from './http'

export const MAX_CONCURRENT = 6
export const LOAD_AHEAD = 32
export const KEEP_BEHIND = 4

interface Entry {
  index: number
  url: string
  buffer: Buffer | null
  state: 'idle' | 'loading' | 'done' | 'failed'
  error: string | null
  promise: Promise<void> | null
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
    entries: urls.map((url, index) => ({ index, url, buffer: null, state: 'idle', error: null, promise: null })),
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

async function loadOne(g: OnlineGallery, e: Entry, headers: Record<string, string>): Promise<void> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const dispatch = g.proxy ? { dispatcher: buildSocksDispatcher(g.proxy) } : {}
      const res = await fetch(e.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...headers },
        signal: controller.signal,
        ...dispatch
      } as any)
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${e.url}`)
      e.buffer = Buffer.from(await res.arrayBuffer())
      e.state = 'done'
    } finally {
      clearTimeout(timer)
    }
  } catch (err: any) {
    e.error = err?.message ?? String(err)
    e.state = 'failed'
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
  if (e.state === 'failed') return Promise.reject(new Error(e.error ?? 'failed'))
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