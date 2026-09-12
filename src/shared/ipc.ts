import type { Settings } from './settings'
import type { HistoryEntry } from './types'
import type { MangaCard } from './mangadex'

export interface OpenFolderResult {
  id: string
  title: string
  pageCount: number
  pages: string[]
  url: string
}

export interface OpenResult {
  id: string
  title: string
  pageCount: number
  source: string
  url: string
  mangaId: string | null
}

export interface ChapterListItem {
  chapter_id: string
  chapter_num: string
  title: string | null
}

export interface Api {
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<void>
  pickFolder(): Promise<OpenFolderResult | null>
  openFolder(path: string): Promise<OpenFolderResult | null>
  getHistory(): Promise<HistoryEntry[]>
  recordProgress(url: string, page: number, total: number): Promise<void>
  clearHistory(): Promise<void>
  openUrl(url: string, startPage?: number, mangaId?: string | null): Promise<OpenResult | null>
  fetchChapterList(mangaId: string): Promise<ChapterListItem[]>
  searchMangaDex(query: string, sort: string, page: number): Promise<MangaCard[]>
  setReadingPosition(id: string, index: number): Promise<void>
}

export const CH = {
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  pickFolder: 'folder:pick',
  openFolder: 'folder:open',
  getHistory: 'history:get',
  recordProgress: 'history:progress',
  clearHistory: 'history:clear',
  openUrl: 'url:open',
  fetchChapterList: 'manga:chapters',
  searchMangaDex: 'catalog:search',
  setReadingPosition: 'reader:position',
  settingsChanged: 'settings:changed'
} as const