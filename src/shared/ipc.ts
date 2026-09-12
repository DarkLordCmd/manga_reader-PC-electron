import type { Settings } from './settings'
import type { HistoryEntry } from './types'

export interface OpenFolderResult {
  id: string
  title: string
  pageCount: number
  pages: string[]
}

export interface Api {
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<void>
  pickFolder(): Promise<OpenFolderResult | null>
  openFolder(path: string): Promise<OpenFolderResult | null>
  getHistory(): Promise<HistoryEntry[]>
  recordProgress(url: string, page: number, total: number): Promise<void>
}

export const CH = {
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  pickFolder: 'folder:pick',
  openFolder: 'folder:open',
  getHistory: 'history:get',
  recordProgress: 'history:progress',
  settingsChanged: 'settings:changed'
} as const