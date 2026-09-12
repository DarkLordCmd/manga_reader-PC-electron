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

export interface CatalogCard {
  url: string
  title: string
  coverUrl: string | null
  pages: number | null
  kind?: string
  score?: number | null
  chapterCount?: number | null
}

export interface EhTagSuggestion { ns: string; tn: string; display: string }
export interface NhentaiTagSuggestion { name: string; count: number }
export interface TorStatus { state: string; latencyMs?: number; reason?: string }
export interface BridgeStatus { line: string; state: string; latencyMs?: number; reason?: string }
export interface SiteStatus { key: string; state: string; reason?: string }

export interface CatalogFilters {
  ehExcludedCats?: number
  mangadexTags?: string[]
  mangadexLangs?: string[]
  nhentaiTags?: string[]
  mangashiSort?: string
  mangashiStatus?: string
  mangashiType?: string
  mangashiYear?: string
  mangashiAgeRating?: string
  mangashiChaptersMin?: string
  mangashiChaptersMax?: string
  mangashiTags?: string[]
  remangaOrdering?: string
  remangaStatus?: string
  remangaTypes?: string
  remangaGenres?: string[]
  remangaCategories?: string[]
}

export interface ExAccount {
  id: number
  name: string
  cookies: [string, string][]
}

export interface ExAccountsResult {
  accounts: ExAccount[]
  currentId: number
}

export interface ImportAccountsResult {
  count: number
  accounts: ExAccountsResult
}

export interface CatalogCursor {
  dir: 'next' | 'prev'
  gid: string
}

export interface Api {
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<void>
  pickFolder(): Promise<OpenFolderResult | null>
  openFolder(path: string): Promise<OpenFolderResult | null>
  rescanFolder(path: string): Promise<OpenFolderResult | null>
  getHistory(): Promise<HistoryEntry[]>
  recordProgress(url: string, page: number, total: number): Promise<void>
  clearHistory(): Promise<void>
  openUrl(url: string, startPage?: number, mangaId?: string | null, coverUrl?: string | null): Promise<OpenResult | null>
  fetchChapterList(mangaId: string): Promise<ChapterListItem[]>
  searchCatalog(source: string, query: string, page: number, sort: string, filters?: CatalogFilters, cursor?: CatalogCursor): Promise<CatalogCard[]>
  loginSite(url: string): Promise<string | null>
  setReadingPosition(id: string, index: number): Promise<void>
  ehTagSuggest(text: string): Promise<EhTagSuggestion[]>
  nhentaiTagSuggest(text: string): Promise<NhentaiTagSuggestion[]>
  checkTor(): Promise<TorStatus>
  checkBridges(lines: string[]): Promise<BridgeStatus[]>
  checkSites(): Promise<SiteStatus[]>
  getExAccounts(): Promise<ExAccountsResult>
  setExAccount(id: number): Promise<ExAccountsResult>
  addExAccount(name: string, memberId: string, passHash: string, igneous: string): Promise<ExAccountsResult>
  removeExAccount(id: number): Promise<ExAccountsResult>
  importExAccounts(): Promise<ImportAccountsResult | null>
  markChapterRead(url: string): Promise<void>
}

export const CH = {
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  pickFolder: 'folder:pick',
  openFolder: 'folder:open',
  rescanFolder: 'folder:rescan',
  getHistory: 'history:get',
  recordProgress: 'history:progress',
  clearHistory: 'history:clear',
  openUrl: 'url:open',
  fetchChapterList: 'manga:chapters',
  searchCatalog: 'catalog:search',
  loginSite: 'login:site',
  setReadingPosition: 'reader:position',
  ehTagSuggest: 'tags:eh',
  nhentaiTagSuggest: 'tags:nhentai',
  checkTor: 'tor:check',
  checkBridges: 'tor:bridges',
  checkSites: 'sites:check',
  getExAccounts: 'ex:accounts',
  setExAccount: 'ex:set',
  addExAccount: 'ex:add',
  removeExAccount: 'ex:remove',
  importExAccounts: 'ex:import',
  markChapterRead: 'reader:markread',
  settingsChanged: 'settings:changed'
} as const

export type { MangaCard }
