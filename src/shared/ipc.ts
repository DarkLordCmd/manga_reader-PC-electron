import type { Settings } from './settings'
import type { HistoryEntry } from './types'
import type { MangaCard } from './mangadex'
import type { DownloadTask } from './downloads'
import type { LibraryItem, LibraryQuery, ReadingStatus } from './library'
import type { SyncState } from './sync'

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
  /** Long-strip sources render as a continuous vertical strip. */
  webtoon?: boolean
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
  cursor?: string | null
}

export interface EhTagSuggestion { ns: string; tn: string; display: string }
export interface NhentaiTagSuggestion { name: string; count: number }
export interface TorStatus { state: string; latencyMs?: number; reason?: string }
export interface BridgeStatus { line: string; state: string; latencyMs?: number; reason?: string }
export interface SiteStatus { key: string; state: string; reason?: string }
export interface LibMirrorStatus { host: string; ok: boolean; ms: number; error?: string }
export interface CustomDnsStatus { server: string; ok: boolean; ip: string | null; ms: number }

export interface CatalogFilters {
  ehExcludedCats?: number
  ehMinRating?: number
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
  senkuroOrdering?: string
  senkuroStatuses?: string[]
  senkuroTypes?: string[]
  senkuroFormats?: string[]
  senkuroRating?: string
  comxCategory?: string
  comxGenre?: string
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

export interface PasswordLoginResult {
  ok: boolean
  message: string
}

export interface ParsedCookieLogin {
  ipbMemberId: string | null
  ipbPassHash: string | null
  igneous: string | null
}

export interface CookieLoginInput {
  ipbMemberId: string
  ipbPassHash: string
  igneous?: string | null
  verify?: boolean
}

export interface CatalogCursor {
  dir: 'next' | 'prev'
  cursor: string
}

export interface EhLimitState {
  blocked: boolean
  until: number
  kind: string
}

export interface ArchiveCost {
  costGp: number | null
  options: { key: string; label: string }[]
  archiverUrl: string
}

export interface PinAttemptResult { locked: boolean; retryAfterSec: number }

export interface BackupFile {
  format: 'manga-reader-backup'
  version: number
  exportedAt: number
  settings: Settings
  series: LibraryItem[]
  accounts?: ExAccount[]
  downloads: DownloadTask[]
}

export interface BackupSummary {
  seriesAdded: number
  seriesUpdated: number
  accountsAdded: number
  downloadsMerged: number
}

export interface GoogleAuthStatus { authed: boolean; email: string | null; configured?: boolean }

export interface Api {
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<void>
  pickFolder(): Promise<OpenFolderResult | null>
  openFolder(path: string): Promise<OpenFolderResult | null>
  rescanFolder(path: string): Promise<OpenFolderResult | null>
  getHistory(): Promise<HistoryEntry[]>
  recordProgress(url: string, page: number, total: number): Promise<void>
  clearHistory(): Promise<void>
  openUrl(url: string, startPage?: number, mangaId?: string | null, coverUrl?: string | null, kind?: string | null): Promise<OpenResult | null>
  fetchChapterList(mangaId: string): Promise<ChapterListItem[]>
  searchCatalog(source: string, query: string, page: number, sort: string, filters?: CatalogFilters, cursor?: CatalogCursor): Promise<CatalogCard[]>
  catalogPopular(source: 'ehentai' | 'exhentai' | 'exhentai_onion'): Promise<CatalogCard[]>
  loginSite(url: string): Promise<string | null>
  loginPassword(user: string, pass: string): Promise<PasswordLoginResult>
  cookieLogin(input: CookieLoginInput): Promise<PasswordLoginResult>
  refreshIgneous(): Promise<PasswordLoginResult>
  parseCookieText(text: string): Promise<ParsedCookieLogin>
  setReadingPosition(id: string, index: number): Promise<void>
  ehTagSuggest(text: string): Promise<EhTagSuggestion[]>
  nhentaiTagSuggest(text: string): Promise<NhentaiTagSuggestion[]>
  checkTor(): Promise<TorStatus>
  checkBridges(lines: string[]): Promise<BridgeStatus[]>
  checkSites(): Promise<SiteStatus[]>
  libMirrorsCheck(): Promise<LibMirrorStatus[]>
  customDnsCheck(): Promise<CustomDnsStatus[]>
  getExAccounts(): Promise<ExAccountsResult>
  setExAccount(id: number): Promise<ExAccountsResult>
  addExAccount(name: string, memberId: string, passHash: string, igneous: string): Promise<ExAccountsResult>
  removeExAccount(id: number): Promise<ExAccountsResult>
  importExAccounts(): Promise<ImportAccountsResult | null>
  markChapterRead(url: string): Promise<void>
  downloadsList(): Promise<DownloadTask[]>
  downloadsAdd(sourceUrl: string): Promise<DownloadTask | null>
  downloadsPause(id: string): Promise<void>
  downloadsResume(id: string): Promise<void>
  downloadsRemove(id: string): Promise<void>
  downloadsSetPriority(id: string, priority: number): Promise<void>
  downloadsOpen(id: string): Promise<OpenFolderResult | null>
  downloadsCheckUpdates(): Promise<string[]>
  downloadsCheckChapters(): Promise<string[]>
  downloadsPickDir(): Promise<string | null>
  ehArchiveCost(url: string): Promise<ArchiveCost | null>
  ehArchiveBuy(url: string, dltype: string): Promise<{ downloadUrl: string } | null>
  downloadsAddArchive(sourceUrl: string, title: string, downloadUrl: string): Promise<DownloadTask | null>
  ehLimitsState(): Promise<EhLimitState>
  pinHasPin(): Promise<boolean>
  pinSetPin(pin: string): Promise<void>
  pinRemovePin(pin: string): Promise<boolean>
  pinVerifyPin(pin: string): Promise<boolean>
  pinFailedAttempt(): Promise<PinAttemptResult>
  onEhLimitsChanged(cb: (state: EhLimitState) => void): () => void
  onDownloadsChanged(cb: (tasks: DownloadTask[]) => void): () => void
  /** Background enrichment: page counts for nhentai catalog cards arrive one by one. */
  onNhentaiCounts(cb: (entries: { url: string; pages: number }[]) => void): () => void
  libraryList(query: LibraryQuery): Promise<LibraryItem[]>
  libraryGet(key: string): Promise<LibraryItem | null>
  libraryStatuses(urls: string[]): Promise<Record<string, ReadingStatus>>
  coverCacheInfo(): Promise<{ files: number; bytes: number; maxBytes: number }>
  coverCacheClear(): Promise<void>
  libraryAdd(entry: { url: string; title: string; coverUrl: string | null; source: string; seriesId: string; category?: string; kind?: string | null }): Promise<LibraryItem>
  libraryLookup(url: string, seriesId: string): Promise<{ key: string; favorited: boolean; status: ReadingStatus | null } | null>
  librarySetFavorite(key: string, at: number | null): Promise<void>
  libraryAddFavorite(entry: { url: string; title: string; coverUrl: string | null; source: string; seriesId: string; category?: string; kind?: string | null }): Promise<LibraryItem>
  librarySetStatusFor(entry: { url: string; title: string; coverUrl: string | null; source: string; seriesId: string; category?: string; kind?: string | null }, status: ReadingStatus): Promise<LibraryItem>
  librarySetStatus(key: string, status: ReadingStatus | null): Promise<void>
  librarySetNote(key: string, note: string): Promise<void>
  librarySetRating(key: string, rating: number | null): Promise<void>
  librarySetTags(key: string, tags: string[]): Promise<void>
  libraryRemove(key: string): Promise<void>
  libraryDelete(key: string): Promise<void>
  libraryCounts(): Promise<Record<string, number>>
  backupExport(includeSecrets: boolean): Promise<{ canceled: boolean; path?: string }>
  backupImport(): Promise<BackupSummary | null>
  googleAuthStatus(): Promise<GoogleAuthStatus>
  googleLogin(): Promise<GoogleAuthStatus>
  googleLogout(): Promise<void>
  syncNow(): Promise<SyncState>
  syncGetState(): Promise<SyncState>
  onSyncChanged(cb: (s: SyncState) => void): () => void
  onLibraryChanged(cb: () => void): () => void
  onSettingsChanged(cb: (s: Settings) => void): () => void
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
  catalogPopular: 'catalog:popular',
  loginSite: 'login:site',
  loginPassword: 'ex:passwordlogin',
  cookieLogin: 'ex:cookielogin',
  refreshIgneous: 'ex:refreshingenous',
  parseCookieText: 'ex:parsecookie',
  setReadingPosition: 'reader:position',
  ehTagSuggest: 'tags:eh',
  nhentaiTagSuggest: 'tags:nhentai',
  checkTor: 'tor:check',
  checkBridges: 'tor:bridges',
  checkSites: 'sites:check',
  libMirrorsCheck: 'libMirrors:check',
  customDnsCheck: 'customDns:check',
  getExAccounts: 'ex:accounts',
  setExAccount: 'ex:set',
  addExAccount: 'ex:add',
  removeExAccount: 'ex:remove',
  importExAccounts: 'ex:import',
  markChapterRead: 'reader:markread',
  downloadsList: 'downloads:list',
  downloadsAdd: 'downloads:add',
  downloadsPause: 'downloads:pause',
  downloadsResume: 'downloads:resume',
  downloadsRemove: 'downloads:remove',
  downloadsSetPriority: 'downloads:setPriority',
  downloadsOpen: 'downloads:open',
  downloadsCheckUpdates: 'downloads:checkUpdates',
  downloadsCheckChapters: 'downloads:checkChapters',
  downloadsPickDir: 'downloads:pickDir',
  downloadsAddArchive: 'downloads:addArchive',
  ehArchiveCost: 'ehArchive:cost',
  ehArchiveBuy: 'ehArchive:buy',
  downloadsChanged: 'downloads:changed',
  ehLimitsState: 'eh-limits:state',
  pinHasPin: 'pin:hasPin',
  pinSetPin: 'pin:setPin',
  pinRemovePin: 'pin:removePin',
  pinVerifyPin: 'pin:verifyPin',
  pinFailedAttempt: 'pin:failedAttempt',
  ehLimitsChanged: 'eh-limits:changed',
  settingsChanged: 'settings:changed',
  googleAuthStatus: 'google:status',
  googleLogin: 'google:login',
  googleLogout: 'google:logout',
  syncNow: 'sync:now',
  syncGetState: 'sync:state',
  syncChanged: 'sync:changed',
  nhentaiCounts: 'catalog:nhentaiCounts',
  libraryList: 'library:list',
  libraryGet: 'library:get',
  libraryAdd: 'library:add',
  libraryLookup: 'library:lookup',
  librarySetFavorite: 'library:setFavorite',
  libraryAddFavorite: 'library:addFavorite',
  librarySetStatusFor: 'library:setStatusFor',
  librarySetStatus: 'library:setStatus',
  librarySetNote: 'library:setNote',
  librarySetRating: 'library:setRating',
  librarySetTags: 'library:setTags',
  libraryRemove: 'library:remove',
  libraryDelete: 'library:delete',
  libraryCounts: 'library:counts',
  libraryStatuses: 'library:statuses',
  coverCacheInfo: 'coverCache:info',
  coverCacheClear: 'coverCache:clear',
  libraryChanged: 'library:changed',
  backupExport: 'backup:export',
  backupImport: 'backup:import',
} as const

export type { MangaCard, DownloadTask }
