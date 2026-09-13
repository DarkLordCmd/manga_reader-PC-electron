import { randomUUID } from 'crypto'
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type { GalleryResolution } from './resolve-gallery'

export interface DownloadTask {
  id: string
  title: string
  sourceUrl: string
  pageUrls: string[]
  headers: Record<string, string>
  proxy?: string
  outDir: string
  state: 'queued' | 'running' | 'paused' | 'completed' | 'error'
  priority: number
  completedPages: number[]
  totalPages: number
  error?: string
  addedAt: number
}

export const PARALLEL = 3

function extFromUrl(url: string): string {
  const m = url.split('?')[0].match(/\.(\w{2,5})$/)
  const ext = m?.[1]?.toLowerCase()
  if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext)) return ext
  return 'bin'
}

function slugify(title: string, id: string): string {
  const base = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'gallery'
  return `${base}-${id.slice(0, 8)}`
}

type NativeTimer = (cb: () => void) => unknown
const schedule = typeof setImmediate === 'function' ? setImmediate : setTimeout

export class DownloadManager {
  private tasks: DownloadTask[] = []
  private inFlight = 0
  private waiters: (() => void)[] = []
  private persistPath: string

  constructor(
    private outDirBase: string,
    persistPath: string,
    private deps: {
      fetchBinary: (url: string, headers?: Record<string, string>, proxy?: string, timeoutMs?: number) => Promise<Uint8Array>
      broadcast: (tasks: DownloadTask[]) => void
    }
  ) {
    this.persistPath = persistPath
    this.loadPersisted()
  }

  private persist(): void {
    try {
      mkdirSync(join(this.persistPath, '..'), { recursive: true })
      writeFileSync(this.persistPath, JSON.stringify(this.tasks, null, 2))
    } catch { /* ignore */ }
  }

  private notify(): void {
    this.persist()
    this.deps.broadcast(this.tasks.map((t) => ({ ...t })))
  }

  loadPersisted(): void {
    if (!existsSync(this.persistPath)) return
    try {
      const raw = JSON.parse(readFileSync(this.persistPath, 'utf-8')) as DownloadTask[]
      this.tasks = raw.map((t) => ({ ...t, state: t.state === 'running' || t.state === 'queued' ? 'queued' : t.state }))
    } catch { this.tasks = [] }
    for (const t of this.tasks) {
      if (t.state !== 'queued') continue
      // rescan outDir for already-downloaded pages
      if (existsSync(t.outDir)) {
        const have = new Set(readdirSync(t.outDir))
        t.completedPages = t.pageUrls
          .map((_u, i) => i)
          .filter((i) => have.has(this.fileName(t, i)))
      }
    }
    if (this.tasks.some((t) => t.state === 'queued')) (schedule as NativeTimer)(() => { void this.pump() })
    this.notify()
  }

  fileName(t: DownloadTask, index: number): string {
    return `${String(index + 1).padStart(3, '0')}.${extFromUrl(t.pageUrls[index] ?? '')}`
  }

  private nextQueued(): DownloadTask | null {
    const cands = this.tasks.filter((t) => t.state === 'queued')
    if (cands.length === 0) return null
    cands.sort((a, b) => b.priority - a.priority || a.addedAt - b.addedAt)
    return cands[0]
  }

  private async pump(): Promise<void> {
    while (this.inFlight < PARALLEL) {
      const t = this.nextQueued()
      if (!t) break
      t.state = 'running'
      this.inFlight++
      void this.runTask(t).finally(() => {
        this.inFlight--
        this.notify()
        void this.pump()
        if (this.inFlight === 0 && !this.tasks.some((x) => x.state === 'queued' || x.state === 'running')) {
          const ws = this.waiters
          this.waiters = []
          for (const w of ws) w()
        }
      })
    }
  }

  private async runTask(t: DownloadTask): Promise<void> {
    mkdirSync(t.outDir, { recursive: true })
    for (let i = 0; i < t.pageUrls.length; i++) {
      if (t.state !== 'running') return
      if (t.completedPages.includes(i)) continue
      try {
        const buf = await this.deps.fetchBinary(t.pageUrls[i], t.headers, t.proxy, 60_000)
        writeFileSync(join(t.outDir, this.fileName(t, i)), Buffer.from(buf))
        t.completedPages.push(i)
        this.notify()
      } catch (e: any) {
        t.error = e?.message ?? String(e)
        t.state = 'error'
        this.notify()
        return
      }
    }
    if (t.state === 'running') t.state = 'completed'
    this.notify()
  }

  async add(sourceUrl: string, resolve: () => Promise<GalleryResolution>, headers: Record<string, string>, proxy?: string): Promise<DownloadTask | null> {
    if (this.tasks.some((t) => t.sourceUrl === sourceUrl && t.state !== 'error')) return null
    const res = await resolve()
    const task: DownloadTask = {
      id: randomUUID(), title: res.title, sourceUrl, pageUrls: res.pageUrls,
      headers, proxy, outDir: join(this.outDirBase, slugify(res.title, randomUUID())),
      state: 'queued', priority: 0, completedPages: [], totalPages: res.pageUrls.length,
      addedAt: Date.now()
    }
    this.tasks.push(task)
    this.notify()
    ;(schedule as NativeTimer)(() => { void this.pump() })
    return task
  }

  pause(id: string): void {
    const t = this.tasks.find((x) => x.id === id)
    if (t && t.state === 'running') { t.state = 'paused'; this.notify() }
  }

  resume(id: string): void {
    const t = this.tasks.find((x) => x.id === id)
    if (t && (t.state === 'paused' || t.state === 'error')) { t.state = 'queued'; delete t.error; this.notify(); (schedule as NativeTimer)(() => { void this.pump() }) }
  }

  remove(id: string): void {
    const t = this.tasks.find((x) => x.id === id)
    if (!t) return
    if (t.state === 'running') t.state = 'paused'
    this.tasks = this.tasks.filter((x) => x.id !== id)
    this.notify()
  }

  setPriority(id: string, priority: number): void {
    const t = this.tasks.find((x) => x.id === id)
    if (t) { t.priority = priority; this.notify() }
  }

  list(): DownloadTask[] { return this.tasks }

  waitIdle(): Promise<void> {
    if (!this.tasks.some((t) => t.state === 'queued' || t.state === 'running')) return Promise.resolve()
    return new Promise((r) => this.waiters.push(r))
  }
}
