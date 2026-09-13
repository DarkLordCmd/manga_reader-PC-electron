import { randomUUID } from 'crypto'
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { GalleryResolution } from './resolve-gallery'
import type { DownloadTask } from '@shared/downloads'
import { extractZipAll } from './zip-gallery'

export type { DownloadTask }

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
      writeFileSync(this.persistPath, JSON.stringify(this.tasks.map(({ epoch: _epoch, ...t }) => t), null, 2))
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
      this.tasks = raw.map((t) => ({ ...t, state: t.state === 'running' || t.state === 'queued' ? 'queued' : t.state, epoch: (t.epoch ?? 0) + 1 }))
    } catch { this.tasks = [] }
    for (const t of this.tasks) {
      if (t.state !== 'queued') continue
      // rescan outDir for already-downloaded pages
      try {
        if (existsSync(t.outDir)) {
          const have = new Set(readdirSync(t.outDir))
          t.completedPages = t.pageUrls
            .map((_u, i) => i)
            .filter((i) => have.has(this.fileName(t, i)))
        }
      } catch { /* outDir vanished or unreadable — leave completedPages as persisted */ }
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

  private async runArchiveTask(t: DownloadTask): Promise<void> {
    const epoch = t.epoch ?? 0
    const zipPath = join(t.outDir, 'archive.zip')
    let buf: Uint8Array
    try {
      buf = await this.deps.fetchBinary(t.archiveDownloadUrl ?? '', t.headers, t.proxy, 600_000)
    } catch (e: any) {
      if (t.epoch !== epoch) return
      const msg = e?.message ?? String(e)
      t.error = /^HTTP 4\d\d/.test(msg)
        ? 'Ссылка на архив устарела (E-Hentai ссылок живёт несколько часов). Купи архив заново.'
        : msg
      t.state = 'error'
      this.notify()
      return
    }
    if (t.epoch !== epoch) return
    if (t.state !== 'running') return
    mkdirSync(t.outDir, { recursive: true })
    writeFileSync(zipPath, Buffer.from(buf))
    this.notify()
    try {
      const written = await extractZipAll(zipPath, t.outDir)
      if (t.epoch !== epoch) return
      rmSync(zipPath, { force: true })
      written.sort()
      t.pageUrls = written
      t.totalPages = written.length
      t.completedPages = Array.from({ length: written.length }, (_v, i) => i)
      if (t.state === 'running') t.state = 'completed'
    } catch (e: any) {
      if (t.epoch !== epoch) return
      t.error = e?.message ?? String(e)
      t.state = 'error'
    }
    this.notify()
  }

  private async runTask(t: DownloadTask): Promise<void> {
    if (t.archiveDownloadUrl) return await this.runArchiveTask(t)
    const epoch = t.epoch ?? 0
    mkdirSync(t.outDir, { recursive: true })
    for (let i = 0; i < t.pageUrls.length; i++) {
      if (t.state !== 'running') return
      if (t.epoch !== epoch) return
      if (t.completedPages.includes(i)) continue
      try {
        const buf = await this.deps.fetchBinary(t.pageUrls[i], t.headers, t.proxy, 60_000)
        if (t.epoch !== epoch) return
        writeFileSync(join(t.outDir, this.fileName(t, i)), Buffer.from(buf))
        if (!t.completedPages.includes(i)) t.completedPages.push(i)
        this.notify()
      } catch (e: any) {
        if (t.epoch !== epoch) return
        t.error = e?.message ?? String(e)
        t.state = 'error'
        this.notify()
        return
      }
    }
    if (t.epoch !== epoch) return
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
      addedAt: Date.now(), epoch: 0
    }
    this.tasks.push(task)
    this.notify()
    ;(schedule as NativeTimer)(() => { void this.pump() })
    return task
  }

  addArchive(sourceUrl: string, title: string, downloadUrl: string, headers: Record<string, string>, proxy?: string): DownloadTask | null {
    if (this.tasks.some((t) => t.sourceUrl === sourceUrl && t.state !== 'error')) return null
    const task: DownloadTask = {
      id: randomUUID(), title, sourceUrl, pageUrls: [],
      archiveDownloadUrl: downloadUrl,
      headers, proxy, outDir: join(this.outDirBase, slugify(title, randomUUID())),
      state: 'queued', priority: 0, completedPages: [], totalPages: 0,
      addedAt: Date.now(), epoch: 0
    }
    this.tasks.push(task)
    this.notify()
    ;(schedule as NativeTimer)(() => { void this.pump() })
    return task
  }

  pause(id: string): void {
    const t = this.tasks.find((x) => x.id === id)
    if (t && t.state === 'running') { t.state = 'paused'; t.epoch = (t.epoch ?? 0) + 1; this.notify() }
  }

  resume(id: string): void {
    const t = this.tasks.find((x) => x.id === id)
    if (t && (t.state === 'paused' || t.state === 'error')) { t.state = 'queued'; t.epoch = (t.epoch ?? 0) + 1; delete t.error; this.notify(); (schedule as NativeTimer)(() => { void this.pump() }) }
  }

  remove(id: string): void {
    const t = this.tasks.find((x) => x.id === id)
    if (!t) return
    if (t.state === 'running') { t.state = 'paused'; t.epoch = (t.epoch ?? 0) + 1 }
    this.tasks = this.tasks.filter((x) => x.id !== id)
    this.notify()
  }

  async checkUpdates(urls: string[], resolve: (url: string) => Promise<GalleryResolution | null>): Promise<string[]> {
    const updated: string[] = []
    for (const url of urls) {
      const t = this.tasks.find((x) => x.sourceUrl === url && x.state === 'completed')
      if (!t) continue
      try {
        const res = await resolve(url)
        if (!res) continue
        if (res.pageUrls.length <= t.pageUrls.length) continue
        t.pageUrls = res.pageUrls
        t.totalPages = res.pageUrls.length
        t.state = 'queued'
        t.epoch = (t.epoch ?? 0) + 1
        updated.push(t.id)
        ;(schedule as NativeTimer)(() => { void this.pump() })
      } catch { /* сеть/лимиты — пропускаем */ }
    }
    if (updated.length > 0) this.notify()
    return updated
  }

  setPriority(id: string, priority: number): void {
    const t = this.tasks.find((x) => x.id === id)
    if (t) { t.priority = priority; this.notify() }
  }

  setOutDirBase(dir: string): void {
    this.outDirBase = dir
  }

  setChapterMeta(id: string, patch: { mangaId?: string; chapterTotal?: number; newChapters?: number; latestChapterId?: string }): void {
    const t = this.tasks.find((x) => x.id === id)
    if (!t) return
    Object.assign(t, patch)
    this.notify()
  }

  list(): DownloadTask[] {
    return this.tasks.map((t) => ({ ...t, completedPages: [...t.completedPages] }))
  }

  waitIdle(): Promise<void> {
    if (!this.tasks.some((t) => t.state === 'queued' || t.state === 'running')) return Promise.resolve()
    return new Promise((r) => this.waiters.push(r))
  }
}
