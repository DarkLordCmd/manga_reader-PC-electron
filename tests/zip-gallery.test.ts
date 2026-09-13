import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'
import { isZipPath, openZipGallery, readZipEntry } from '../src/main/services/zip-gallery'

// powershell Compress-Archive создаёт zip без внешних зависимостей
function makeTestZip(zipPath: string, files: Record<string, Buffer>): void {
  const staging = join(zipPath, '..', 'staging-zip')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const p = join(staging, name)
    writeFileSync(p, content)
  }
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${staging}\\*' -DestinationPath '${zipPath}' -Force"`)
  rmSync(staging, { recursive: true, force: true })
}

describe('zip-gallery', () => {
  let dir: string
  let tmp: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zip-')); tmp = join(dir, 'tmp') })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('isZipPath', () => {
    expect(isZipPath('a.ZIP')).toBe(true)
    expect(isZipPath('a.cbz')).toBe(true)
    expect(isZipPath('a.jpg')).toBe(false)
  })

  it('opens zip and sorts entries naturally', async () => {
    const zip = join(dir, 'test.zip')
    makeTestZip(zip, { '2.jpg': Buffer.from([2]), '10.jpg': Buffer.from([10]), '1.jpg': Buffer.from([1]) })
    const g = await openZipGallery(zip, tmp)
    expect(g).not.toBeNull()
    expect(g!.pageCount).toBe(3)
    const names = g!.entries.map((e) => e.split(/[\\/]/).pop()!)
    expect(names.indexOf('10.jpg')).toBeGreaterThan(names.indexOf('2.jpg'))
    expect(names.indexOf('1.jpg')).toBeLessThan(names.indexOf('2.jpg'))
  })

  it('reads entry lazily into tmp cache', async () => {
    const zip = join(dir, 'test.zip')
    makeTestZip(zip, { '1.jpg': Buffer.from([1, 2, 3]) })
    const g = await openZipGallery(zip, tmp)
    const p = await readZipEntry(zip, g!.entries[0], tmp)
    expect(existsSync(p)).toBe(true)
    const p2 = await readZipEntry(zip, g!.entries[0], tmp)
    expect(p2).toBe(p) // cached
  })

  it('flattens traversal paths so zip-slip cannot escape the tmp cache dir', async () => {
    const zip = join(dir, 'test.zip')
    makeTestZip(zip, { '1.jpg': Buffer.from([1]) })
    // entryName is flattened to '__evil.jpg' inside the cache dir, so the
    // lookup by raw name '../evil.jpg' finds nothing in the zip -> reject;
    // crucially nothing is ever written outside tmpBase.
    await expect(readZipEntry(zip, '../evil.jpg', tmp)).rejects.toThrow('entry not found')
    expect(existsSync(join(tmp, '__evil.jpg'))).toBe(false)
    expect(existsSync(join(tmp, '..', 'evil.jpg'))).toBe(false)
  })

  it('dedupes concurrent extractions of the same entry', async () => {
    const zip = join(dir, 'test.zip')
    const content = Buffer.from([9, 8, 7, 6])
    makeTestZip(zip, { 'big.jpg': content })
    await openZipGallery(zip, tmp)
    const [a, b] = await Promise.all([readZipEntry(zip, 'big.jpg', tmp), readZipEntry(zip, 'big.jpg', tmp)])
    expect(b).toContain(a)
    expect(existsSync(a)).toBe(true)
    expect(readFileSync(a)).toEqual(content)
    // No partial .part files left behind
    expect(existsSync(a + '.part-0')).toBe(false)
  })
})
