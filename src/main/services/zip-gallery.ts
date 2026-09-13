import yauzl from 'yauzl'
import { createHash } from 'crypto'
import { mkdirSync, existsSync, createWriteStream, rmSync, renameSync, readdirSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { naturalCompare } from './natural-sort'

const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i

export function isZipPath(p: string): boolean {
  return /\.(zip|cbz)$/i.test(p)
}

function zipId(zipPath: string): string {
  return createHash('sha1').update(zipPath.toLowerCase()).digest('hex').slice(0, 12)
}

export interface ZipGalleryInfo {
  id: string
  title: string
  pageCount: number
  entries: string[]
}

const entriesCache = new Map<string, string[]>()

function listEntries(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return reject(err ?? new Error('cannot open zip'))
      const out: string[] = []
      zf.on('entry', (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith('/') && IMAGE_RE.test(entry.fileName)) out.push(entry.fileName)
        zf.readEntry()
      })
      zf.on('end', () => { zf.close(); resolve(out) })
      zf.on('error', reject)
      zf.readEntry()
    })
  })
}

export async function openZipGallery(zipPath: string, tmpBase: string): Promise<ZipGalleryInfo | null> {
  const raw = await listEntries(zipPath)
  if (raw.length === 0) return null
  const entries = raw.sort(naturalCompare)
  const id = zipId(zipPath)
  entriesCache.set(id, entries)
  const title = zipPath.split(/[\\/]/).pop()?.replace(/\.(zip|cbz)$/i, '') ?? 'Archive'
  return { id, title, pageCount: entries.length, entries }
}

// In-flight promise map keyed by resolved dest path: concurrent readZipEntry
// calls for the same entry share a single extraction instead of racing
// writes to the same file.
const inflight = new Map<string, Promise<string>>()

export function readZipEntry(zipPath: string, entryName: string, tmpBase: string): Promise<string> {
  const id = zipId(zipPath)
  // Path flattening: any '../' segments and slashes in entryName are collapsed
  // into the literal separator '__', so the resolved dest always stays inside
  // tmpBase/<id>/ and a crafted zip entry like '../evil.jpg' cannot escape
  // the cache directory (zip-slip).
  const dest = join(tmpBase, id, entryName.replace(/[\\/]+/g, '__'))
  const cached = existsSync(dest) ? Promise.resolve(dest) : undefined
  const pending = inflight.get(dest)
  if (pending) return pending
  const work = cached ?? extractEntry(zipPath, entryName, dest).finally(() => inflight.delete(dest))
  inflight.set(dest, work)
  return work
}

function extractEntry(zipPath: string, entryName: string, dest: string): Promise<string> {
  mkdirSync(join(dest, '..'), { recursive: true })
  // Extract to a temporary .part-<random> file first, then rename atomically,
  // so a partial/crashed write never looks like a complete cached file.
  const part = `${dest}.part-${randomBytes(6).toString('hex')}`
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return reject(err ?? new Error('cannot open zip'))
      let found = false
      zf.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== entryName) { zf.readEntry(); return }
        found = true
        zf.openReadStream(entry, (err2, stream) => {
          if (err2 || !stream) { zf.close(); return reject(err2 ?? new Error('no stream')) }
          const ws = createWriteStream(part)
          stream.pipe(ws)
          ws.on('close', () => {
            zf.close()
            try { renameSync(part, dest); resolve(dest) } catch (e) { reject(e) }
          })
          ws.on('error', (e) => { zf.close(); reject(e) })
        })
      })
      zf.on('end', () => {
        zf.close()
        if (!found) { reject(new Error('entry not found')) } else if (existsSync(part)) { rmSync(part, { force: true }) }
      })
      zf.on('error', reject)
      zf.readEntry()
    })
  })
}

/**
 * Extracts all file entries of a zip into outDir. Directory structure inside
 * the zip is flattened (same '__' separator rule as readZipEntry), and any
 * entry path containing '..' is skipped (zip-slip guard).
 */
export function extractZipAll(zipPath: string, outDir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return reject(err ?? new Error('cannot open zip'))
      const written: string[] = []
      zf.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName
        if (name.endsWith('/') || name.split(/[\\/]/).includes('..')) { zf.readEntry(); return }
        const dest = join(outDir, name.replace(/[\\/]+/g, '__'))
        zf.openReadStream(entry, (err2, stream) => {
          if (err2 || !stream) { zf.close(); return reject(err2 ?? new Error('no stream')) }
          written.push(dest)
          const ws = createWriteStream(dest)
          stream.pipe(ws)
          ws.on('close', () => zf.readEntry())
          ws.on('error', (e) => { zf.close(); reject(e) })
        })
      })
      zf.on('end', () => { zf.close(); resolve(written) })
      zf.on('error', reject)
      zf.readEntry()
    })
  })
}

export function clearZipTmp(tmpBase: string, zipId: string): void {
  rmSync(join(tmpBase, zipId), { recursive: true, force: true })
}

export function clearZipTmpAll(tmpBase: string): void {
  let entries: string[]
  try {
    entries = readdirSync(tmpBase)
  } catch {
    return
  }
  for (const name of entries) {
    try { rmSync(join(tmpBase, name), { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
