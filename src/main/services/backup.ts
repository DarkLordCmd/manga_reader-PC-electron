import type { Settings } from '@shared/settings'
import type { LibraryItem } from '@shared/library'
import type { BackupFile, BackupSummary, ExAccount } from '@shared/ipc'
import type { DownloadTask } from '@shared/downloads'

export const BACKUP_FORMAT = 'manga-reader-backup' as const
export const BACKUP_VERSION = 1

const SECRET_SETTINGS = [
  'onion_cookies_raw', 'nhentai_cookies_raw', 'nhentai_onion_cookies_raw',
  'senkuro_cookies_raw', 'exhentai_proxy_addr', 'mangalib_proxy_addr', 'tor_bridges'
] as const

export function sanitizeSettings(s: Settings, includeSecrets: boolean): Settings {
  if (includeSecrets) return { ...s }
  const out = { ...s }
  for (const k of SECRET_SETTINGS) (out as any)[k] = ''
  return out
}

export function buildBackup(
  settings: Settings,
  series: LibraryItem[],
  accounts: ExAccount[],
  downloads: DownloadTask[],
  includeSecrets: boolean
): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings: sanitizeSettings(settings, includeSecrets),
    series,
    accounts: includeSecrets ? accounts : undefined,
    downloads
  }
}

export function parseBackup(text: string): BackupFile {
  let obj: any
  try { obj = JSON.parse(text) } catch { throw new Error('Файл не является корректным JSON') }
  if (!obj || obj.format !== BACKUP_FORMAT) throw new Error('Это не файл резервной копии Manga Reader')
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
    throw new Error(`Неподдерживаемая версия бэкапа: ${obj.version}`)
  }
  if (!Array.isArray(obj.series) || !Array.isArray(obj.downloads)) {
    throw new Error('Повреждённый бэкап: нет series/downloads')
  }
  return obj as BackupFile
}
