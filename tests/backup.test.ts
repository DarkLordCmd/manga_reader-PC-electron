import { describe, it, expect } from 'vitest'
import { sanitizeSettings, parseBackup, BACKUP_FORMAT, BACKUP_VERSION } from '../src/main/services/backup'
import { defaultSettings } from '../src/shared/settings'
import type { LibraryItem } from '../src/shared/library'

const item = (over: Partial<LibraryItem> = {}): LibraryItem => ({
  key: 'nh:1', seriesId: 'nh:1', url: 'https://nhentai.net/g/1/', title: 'A', coverUrl: null,
  source: 'NHentai', category: 'r34', currentPage: 1, totalPages: 10, chapterLabel: null,
  chapterIndex: null, chapterTotal: null, status: 'reading', note: '', rating: null, tags: [],
  openedAt: 1, createdAt: 1, updatedAt: 1, ...over
})

describe('sanitizeSettings', () => {
  it('strips secrets by default and keeps them with includeSecrets', () => {
    const s = { ...defaultSettings(), onion_cookies_raw: 'SECRET', exhentai_proxy_addr: '1.2.3.4:9', tor_bridges: 'obfs4 x' }
    const clean = sanitizeSettings(s, false)
    expect(clean.onion_cookies_raw).toBe('')
    expect(clean.exhentai_proxy_addr).toBe('')
    expect(clean.tor_bridges).toBe('')
    const full = sanitizeSettings(s, true)
    expect(full.onion_cookies_raw).toBe('SECRET')
    expect(full.exhentai_proxy_addr).toBe('1.2.3.4:9')
  })
})

describe('parseBackup', () => {
  it('rejects wrong format/version', () => {
    expect(() => parseBackup('{}')).toThrow()
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 999 }))).toThrow()
  })
  it('accepts a valid envelope', () => {
    const text = JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: 1, settings: defaultSettings(), series: [item()], downloads: [] })
    expect(parseBackup(text).series).toHaveLength(1)
  })
  it('rejects a backup without settings', () => {
    const text = JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: 1, series: [item()], downloads: [] })
    expect(() => parseBackup(text)).toThrow('Повреждённый бэкап: нет настроек')
  })
  it('rejects a non-positive/zero version', () => {
    const text = JSON.stringify({ format: BACKUP_FORMAT, version: 0, exportedAt: 1, settings: defaultSettings(), series: [item()], downloads: [] })
    expect(() => parseBackup(text)).toThrow()
  })
  it('rejects a series entry without a key', () => {
    const text = JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: 1, settings: defaultSettings(), series: [{ seriesId: 'nh:1' }], downloads: [] })
    expect(() => parseBackup(text)).toThrow('Повреждённый бэкап: некорректная запись серии')
  })
})
