import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DownloadManager } from '../src/main/services/download-manager'

describe('update sync', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dlupd-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('appends new pages when page count grows', async () => {
    let urls = ['u1', 'u2']
    const m = new DownloadManager(join(dir, 'dl'), join(dir, 'd.json'), {
      fetchBinary: async () => new Uint8Array([1]),
      broadcast: () => {}
    })
    const t = await m.add('https://x/g/1/', async () => ({
      title: 'T', pageUrls: urls, coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's'
    }), {})
    await m.waitIdle()
    expect(t!.state).toBe('completed')
    urls = ['u1', 'u2', 'u3', 'u4']
    const updated = await m.checkUpdates(['https://x/g/1/'], async () => ({
      title: 'T', pageUrls: urls, coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's'
    }))
    expect(updated).toContain(t!.id)
    await m.waitIdle()
    expect(t!.pageUrls).toHaveLength(4)
    expect(t!.state).toBe('completed')
  })

  it('no update when count unchanged', async () => {
    const m = new DownloadManager(join(dir, 'dl'), join(dir, 'd.json'), {
      fetchBinary: async () => new Uint8Array([1]),
      broadcast: () => {}
    })
    await m.add('https://x/g/1/', async () => ({
      title: 'T', pageUrls: ['u1'], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's'
    }), {})
    await m.waitIdle()
    const updated = await m.checkUpdates(['https://x/g/1/'], async () => ({
      title: 'T', pageUrls: ['u1'], coverUrl: null, source: 'S', referer: null, mangaId: null, seriesId: 's'
    }))
    expect(updated).toEqual([])
  })
})
