import type { LibraryItem } from '@shared/library'
import type { Settings } from '@shared/settings'

export const SYNC_FORMAT = 'manga-reader-sync' as const
export const SYNC_VERSION = 1

export interface SyncSettings {
  reading_mode: 'Scroll' | 'Book'
  book_direction: 'Ltr' | 'Rtl'
  width_scale: number
  pages_per_screen: number
  page_margin: number
  infinite_scroll: boolean
  nhentai_show_page_counts: boolean
  show_thumbnails: boolean
  thumb_size: number
  show_r34_history: boolean
  library_auto_add: boolean
}

export interface SyncPayload {
  format: typeof SYNC_FORMAT
  version: number
  updatedAt: number
  series: LibraryItem[]
  settings: SyncSettings
  settingsUpdatedAt: number
}

export function extractSyncSettings(s: Settings): SyncSettings {
  return {
    reading_mode: s.reading_mode, book_direction: s.book_direction, width_scale: s.width_scale,
    pages_per_screen: s.pages_per_screen, page_margin: s.page_margin, infinite_scroll: s.infinite_scroll,
    nhentai_show_page_counts: s.nhentai_show_page_counts, show_thumbnails: s.show_thumbnails,
    thumb_size: s.thumb_size, show_r34_history: s.show_r34_history, library_auto_add: s.library_auto_add
  }
}

export function applySyncSettings(s: Settings, sub: SyncSettings): Settings {
  return { ...s, ...sub }
}

export function buildSyncPayload(series: LibraryItem[], settings: Settings, settingsUpdatedAt: number): SyncPayload {
  return {
    format: SYNC_FORMAT, version: SYNC_VERSION, updatedAt: Date.now(),
    series: series.map((i) => ({ ...i, tags: [...i.tags] })),
    settings: extractSyncSettings(settings), settingsUpdatedAt
  }
}

export function mergeSyncPayload(local: SyncPayload, remote: SyncPayload): SyncPayload {
  const map = new Map<string, LibraryItem>()
  for (const i of local.series) map.set(i.key, i)
  for (const i of remote.series) {
    const cur = map.get(i.key)
    if (!cur || i.updatedAt > cur.updatedAt) map.set(i.key, i)
  }
  const remoteWins = remote.settingsUpdatedAt > local.settingsUpdatedAt
  return {
    format: SYNC_FORMAT, version: SYNC_VERSION,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    series: [...map.values()],
    settings: remoteWins ? remote.settings : local.settings,
    settingsUpdatedAt: remoteWins ? remote.settingsUpdatedAt : local.settingsUpdatedAt
  }
}

export function parseSyncPayload(text: string): SyncPayload {
  let obj: any
  try { obj = JSON.parse(text) } catch { throw new Error('Файл синхронизации повреждён (не JSON)') }
  if (!obj || obj.format !== SYNC_FORMAT) throw new Error('Это не файл синхронизации Manga Reader')
  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 1 || obj.version > SYNC_VERSION) {
    throw new Error(`Неподдерживаемая версия синхронизации: ${obj.version}`)
  }
  if (!Array.isArray(obj.series)) throw new Error('Файл синхронизации повреждён: нет series')
  for (const s of obj.series) {
    if (!s || typeof s !== 'object' || typeof s.key !== 'string' || !s.key || typeof s.url !== 'string' || typeof s.title !== 'string') {
      throw new Error('Файл синхронизации повреждён: некорректная запись')
    }
  }
  if (!obj.settings || typeof obj.settings !== 'object' || Array.isArray(obj.settings)) {
    throw new Error('Файл синхронизации повреждён: нет настроек')
  }
  return obj as SyncPayload
}
