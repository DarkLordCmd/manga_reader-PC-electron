import yauzl from 'yauzl'
import { createHash } from 'crypto'
import { mkdirSync, existsSync, createWriteStream, rmSync } from 'fs'
import { join } from 'path'
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

export function readZipEntry(zipPath: string, entryName: string, tmpBase: string): Promise<string> {
  const id = zipId(zipPath)
  const dest = join(tmpBase, id, entryName.replace(/[\\/]/g, '__'))
  if (existsSync(dest)) return Promise.resolve(dest)
  mkdirSync(join(dest, '..'), { recursive: true })
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return reject(err ?? new Error('cannot open zip'))
      let found = false
      zf.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== entryName) { zf.readEntry(); return }
        found = true
        zf.openReadStream(entry, (err2, stream) => {
          if (err2 || !stream) { zf.close(); return reject(err2 ?? new Error('no stream')) }
          const ws = createWriteStream(dest)
          stream.pipe(ws)
          ws.on('close', () => { zf.close(); resolve(dest) })
          ws.on('error', reject)
        })
      })
      zf.on('end', () => { zf.close(); if (!found) reject(new Error('entry not found')) })
      zf.on('error', reject)
      zf.readEntry()
    })
  })
}

export function clearZipTmp(tmpBase: string, zipId: string): void {
  rmSync(join(tmpBase, zipId), { recursive: true, force: true })
}
