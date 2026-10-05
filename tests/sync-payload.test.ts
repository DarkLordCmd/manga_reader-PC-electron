import { describe, it, expect } from 'vitest'
import {
  buildSyncPayload, mergeSyncPayload, parseSyncPayload, extractSyncSettings, applySyncSettings,
  SYNC_FORMAT, SYNC_VERSION
} from '../src/main/services/sync-payload'
import { defaultSettings } from '../src/shared/settings'
import type { LibraryItem } from '../src/shared/library'

const item = (over: Partial<LibraryItem> = {}): LibraryItem => ({
  key: 'k', seriesId: 'k', url: 'u', title: 'T', coverUrl: null, source: 'S', category: 'main',
  currentPage: 1, totalPages: 0, chapterLabel: null, chapterIndex: null, chapterTotal: null,
  status: 'reading', note: '', rating: null, tags: [], openedAt: 1, createdAt: 1, updatedAt: 1,
  deletedAt: null, ...over
})

describe('sync settings subset', () => {
  it('extracts and applies portable fields only', () => {
    const s = { ...defaultSettings(), onion_cookies_raw: 'SECRET', downloads_dir: 'C:/x', width_scale: 0.5, reading_mode: 'Book' as const }
    const sub = extractSyncSettings(s)
    expect(sub.width_scale).toBe(0.5)
    expect((sub as any).onion_cookies_raw).toBeUndefined()
    const back = applySyncSettings(s, { ...sub, width_scale: 0.9 })
    expect(back.width_scale).toBe(0.9)
    expect(back.onion_cookies_raw).toBe('SECRET') // not touched
  })

  it('ignores foreign keys on the incoming sub (no secret leak / pollution)', () => {
    const s = { ...defaultSettings(), onion_cookies_raw: 'SECRET' }
    const sub = extractSyncSettings(s)
    const back = applySyncSettings(s, { ...sub, onion_cookies_raw: 'X', downloads_dir: 'D:/evil' } as any)
    expect(back.onion_cookies_raw).toBe('SECRET')
    expect(back.downloads_dir).toBe(s.downloads_dir)
    expect(back.width_scale).toBe(sub.width_scale)
  })
})

describe('mergeSyncPayload', () => {
  it('newest updatedAt wins per key, including tombstones', () => {
    const local = buildSyncPayload([item({ key: 'a', title: 'L', updatedAt: 10 })], defaultSettings(), 5)
    const remote = buildSyncPayload(
      [item({ key: 'a', title: 'R', updatedAt: 20 }), item({ key: 'b', title: 'B', updatedAt: 1 }), item({ key: 'c', deletedAt: 99, updatedAt: 99 })],
      defaultSettings(), 5
    )
    const m = mergeSyncPayload(local, remote)
    const byKey = Object.fromEntries(m.series.map((i) => [i.key, i]))
    expect(byKey.a.title).toBe('R')
    expect(byKey.b.title).toBe('B')
    expect(byKey.c.deletedAt).toBe(99)
  })

  it('takes settings from the newer settingsUpdatedAt', () => {
    const a = buildSyncPayload([], { ...defaultSettings(), width_scale: 0.4 }, 10)
    const b = buildSyncPayload([], { ...defaultSettings(), width_scale: 0.8 }, 20)
    expect(mergeSyncPayload(a, b).settings.width_scale).toBe(0.8)
    expect(mergeSyncPayload(b, a).settings.width_scale).toBe(0.8)
  })
})

describe('parseSyncPayload', () => {
  it('rejects wrong format/version and validates series', () => {
    expect(() => parseSyncPayload('{}')).toThrow()
    expect(() => parseSyncPayload(JSON.stringify({ format: SYNC_FORMAT, version: 999 }))).toThrow()
    const ok = JSON.stringify(buildSyncPayload([item()], defaultSettings(), 1))
    expect(parseSyncPayload(ok).series).toHaveLength(1)
  })
})
