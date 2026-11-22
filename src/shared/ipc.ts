import type { Settings } from './settings';
import type { HistoryEntry } from './types';
import type { MangaCard } from './mangadex';
import type { DownloadTask } from './downloads';
import type { LibraryItem, LibraryQuery, ReadingStatus } from './library';
import type { SyncState } from './sync';

export interface OpenFolderResult {
  id: string;
  title: string;
  pageCount: number;
  pages: string[];
  url: string;
}

export interface OpenResult {
  id: string;
  title: string;
  pageCount: number;
  source: string;
  url: string;
  mangaId: string | null;
  /** Long-strip sources render as a continuous vertical strip. */
  webtoon?: boolean;
}

export interface ChapterListItem {
  chapter_id: string;
  chapter_num: string;
  title: string | null;
}

export interface CatalogCard {
  url: string;
  title: string;
  coverUrl: string | null;
  pages: number | null;
  kind?: string;
  score?: number | null;
  chapterCount?: number | null;
  cursor?: string | null;
  /** Source tags when the listing exposes them (MangaDex, E-Hentai, …). */
  tags?: string[];
  /** R34 (hentai/smut) work — hidden while the R34 privacy toggle is off. */
  adult?: boolean;
  /** Age rating is 18+ (may be violent action/horror, not necessarily R34). */
  age18?: boolean;
  /** Publication status (Senkuro: Анонс/Выходит/Завершён/Заморожен/Отменён). */
  status?: string | null;
}

export interface EhTagSuggestion {
  ns: string;
  tn: string;
  display: string;
}

/** One row of the catalog search autocomplete. `work` rows open the title,
 * `tag` rows (E-Hentai has no work autocomplete, only its tag API) append the
 * tag to the query. */
export interface SearchSuggestion {
  kind: 'work' | 'tag';
  title: string;
  /** Source series URL / MangaDex id used to open the title. */
  url?: string | null;
  coverUrl?: string | null;
  /** "Манхва · ★ 8.45 · Онгоинг · Переводится". */
  meta?: string | null;
  /** Tag namespace ("female") for tag rows. */
  subtitle?: string | null;
  /** Full tag as `ns:tn` for tag rows. */
  tag?: string | null;
  /** Publication status when the source provides it (Senkuro). */
  status?: string | null;
  /** Age rating is 18+ (Senkuro EXPLICIT, MangaDex erotica, NHentai). */
  age18?: boolean;
}
export interface NhentaiTagSuggestion {
  name: string;
  count: number;
}
export interface TorStatus {
  state: string;
  latencyMs?: number;
  reason?: string;
}
export interface BridgeStatus {
  line: string;
  state: string;
  latencyMs?: number;
  reason?: string;
  /** What the Tor daemon itself experienced on the last real bootstrap attempt
   * (the TCP probe above cannot see an obfs4-level rejection). */
  lastBootstrap?: { ok: boolean; at: number } | null;
}
export interface SiteStatus {
  key: string;
  state: string;
  reason?: string;
}
export interface LibMirrorStatus {
  host: string;
  ok: boolean;
  ms: number;
  error?: string;
}
export interface CustomDnsStatus {
  server: string;
  ok: boolean;
  ip: string | null;
  ms: number;
}

export interface CatalogFilters {
  ehExcludedCats?: number;
  ehMinRating?: number;
  /** Only galleries on the account's watching list (f_sh=1). */
  ehWatchedOnly?: boolean;
  /** Show the site toplist for the last N days instead of search results. */
  ehToplist?: number;
  mangadexTags?: string[];
  mangadexLangs?: string[];
  nhentaiTags?: string[];
  mangashiSort?: string;
  mangashiStatus?: string;
  mangashiType?: string;
  mangashiYear?: string;
  mangashiAgeRating?: string;
  mangashiChaptersMin?: string;
  mangashiChaptersMax?: string;
  mangashiTags?: string[];
  remangaOrdering?: string;
  remangaStatus?: string;
  remangaTypes?: string;
  remangaGenres?: string[];
  remangaCategories?: string[];
  senkuroOrdering?: string;
  senkuroStatuses?: string[];
  senkuroTypes?: string[];
  senkuroFormats?: string[];
  /** Multi-select age ratings (GENERAL/SENSITIVE/QUESTIONABLE/EXPLICIT). */
  senkuroRatings?: string[];
  /** Original source enums (ANIME/COMIC/…). */
  senkuroSources?: string[];
  /** Translation status enums (IN_PROGRESS/…). */
  senkuroTranslation?: string[];
  /** ISO origin country codes (KR/JP/…). */
  senkuroCountries?: string[];
  /** Label slugs (from the label dictionary). */
  senkuroLabels?: string[];
  senkuroChaptersFrom?: number;
  senkuroChaptersTo?: number;
  senkuroYearFrom?: number;
  senkuroYearTo?: number;
  comxCategory?: string;
  comxGenre?: string;
}

export interface EhTorrent {
  title: string;
  size: string;
  seeds: number;
  peers: number;
  downloads: number;
  uploader: string;
  posted: string;
  torrentUrl: string;
  magnet: string;
  outdated: boolean;
}

export interface EhComment {
  author: string;
  text: string;
  uploader: boolean;
}

export interface EhGalleryInfo {
  title: string;
  uploader: string;
  posted: string;
  parent: string;
  visible: string;
  language: string;
  fileSize: string;
  length: string;
  rating: number | null;
  ratingCount: number | null;
  tags: { namespace: string; key: string }[];
  comments: EhComment[];
}

export interface EhFavoriteItem {
  url: string;
  title: string;
  coverUrl: string | null;
}

/** Live progress of the Senkognito → library import. */
export interface SenkuroImportProgress {
  phase: 'bookmarks' | 'chapters' | 'saving';
  done: number;
  total: number;
  title?: string;
}

export interface TorDiagnostics {
  running: boolean;
  socks: string | null;
  bootstrap: string | null;
  circuits: number;
  exits: string[];
  bridgeCount: number;
}

export interface SenkuroImportResult {
  ok: boolean;
  message: string;
  imported: number;
  byStatus: Record<string, number>;
  /** Chapters marked as read (bounded by the app's 4000-entry read list). */
  chaptersMarked: number;
  /** Chapters for which a resume page was stored. */
  resumePoints: number;
  errors: number;
}


export interface ExAccount {
  id: number;
  name: string;
  cookies: [string, string][];
}

export interface ExAccountsResult {
  accounts: ExAccount[];
  currentId: number;
}

export interface ImportAccountsResult {
  count: number;
  accounts: ExAccountsResult;
}

export interface PasswordLoginResult {
  ok: boolean;
  message: string;
}

export interface ParsedCookieLogin {
  ipbMemberId: string | null;
  ipbPassHash: string | null;
  igneous: string | null;
}

export interface CookieLoginInput {
  ipbMemberId: string;
  ipbPassHash: string;
  igneous?: string | null;
  verify?: boolean;
}

export interface CatalogCursor {
  dir: 'next' | 'prev';
  cursor: string;
}

export interface EhLimitState {
  blocked: boolean;
  until: number;
  kind: string;
}

export interface ArchiveCost {
  costGp: number | null;
  options: { key: string; label: string }[];
  archiverUrl: string;
}

export interface PinAttemptResult {
  locked: boolean;
  retryAfterSec: number;
}

export interface BackupFile {
  format: 'manga-reader-backup';
  version: number;
  exportedAt: number;
  settings: Settings;
  series: LibraryItem[];
  accounts?: ExAccount[];
  downloads: DownloadTask[];
}

export interface BackupSummary {
  seriesAdded: number;
  seriesUpdated: number;
  accountsAdded: number;
  downloadsMerged: number;
}

export interface GoogleAuthStatus {
  authed: boolean;
  email: string | null;
  configured?: boolean;
}

export interface Api {
  getSettings(): Promise<Settings>;
  setSettings(s: Settings): Promise<void>;
  pickFolder(): Promise<OpenFolderResult | null>;
  openFolder(path: string): Promise<OpenFolderResult | null>;
  rescanFolder(path: string): Promise<OpenFolderResult | null>;
  getHistory(): Promise<HistoryEntry[]>;
  recordProgress(url: string, page: number, total: number, offset?: number): Promise<void>;
  /** MangaDex "continue" marker (series id → chapter index). A dedicated call
   * instead of echoing the whole settings object: the echo guard used to treat
   * a deliberate rollback to an earlier chapter as a stale value and dropped it. */
  setSeriesProgress(seriesId: string, index: number, total: number): Promise<void>;
  clearHistory(): Promise<void>;
  openUrl(
    url: string,
    startPage?: number,
    mangaId?: string | null,
    coverUrl?: string | null,
    kind?: string | null,
    chapterIndex?: number | null,
    adult?: boolean,
  ): Promise<OpenResult | null>;
  fetchChapterList(mangaId: string): Promise<ChapterListItem[]>;
  catalogTags(url: string): Promise<string[]>;
  /** Batch adult-flag resolution for sources whose listing has no reliable age
   * signal (Manga-shi): one IPC round-trip for a whole page of cards. */
  catalogAdultBatch(urls: string[]): Promise<Record<string, boolean>>;
  searchCatalog(
    source: string,
    query: string,
    page: number,
    sort: string,
    filters?: CatalogFilters,
    cursor?: CatalogCursor,
  ): Promise<CatalogCard[]>;
  catalogPopular(source: 'ehentai' | 'exhentai' | 'exhentai_onion'): Promise<CatalogCard[]>;
  loginSite(url: string): Promise<string | null>;
  loginPassword(user: string, pass: string): Promise<PasswordLoginResult>;
  cookieLogin(input: CookieLoginInput): Promise<PasswordLoginResult>;
  refreshIgneous(): Promise<PasswordLoginResult>;
  parseCookieText(text: string): Promise<ParsedCookieLogin>;
  /** Clears a stored session explicitly. Editing the cookie textarea cannot do
   * this: an empty echo is restored to protect a fresh login from a stale
   * snapshot, so there was no way to log out of a site. */
  clearSiteCookies(field: 'onion' | 'nhentai' | 'nhentai_onion' | 'senkuro'): Promise<void>;
  setReadingPosition(id: string, index: number): Promise<void>;
  ehTagSuggest(text: string): Promise<EhTagSuggestion[]>;
  /** Per-source search autocomplete (each source asks its own site/API). */
  catalogSuggest(source: string, query: string): Promise<SearchSuggestion[]>;
  nhentaiTagSuggest(text: string): Promise<NhentaiTagSuggestion[]>;
  checkTor(): Promise<TorStatus>;
  /** E-Hentai image-limit reset (the site's own "Reset Limit" action). */
  ehResetImageLimit(): Promise<{ ok: boolean; message: string }>;
  /** Gallery torrents popup (magnet links). */
  ehTorrents(url: string): Promise<EhTorrent[]>;
  /** Gallery metadata, tags and comments (read-only). */
  ehGalleryInfo(url: string): Promise<EhGalleryInfo>;
  /** One page of the account's EH favorites (import source). */
  ehFavorites(page: number): Promise<{ items: EhFavoriteItem[]; hasMore: boolean }>;  /** H@H download request for a gallery (needs H@H/GP on the account). */
  ehHathDownload(url: string, resolution: string): Promise<{ ok: boolean; message: string }>;
  /** Full label dictionary for the Senkuro filter panel (slug + RU name). */
  senkuroLabels(): Promise<{ slug: string; name: string }[]>;
  /** Bundled Tor: bootstrap phase, built circuits, current exits, bridge count. */
  torDiagnostics(): Promise<TorDiagnostics>;
  /** Import the Senkuro/Senkognito bookmarks (statuses, progress, read chapters). */
  senkuroImportBookmarks(opts?: { statuses?: string[]; markRead?: boolean; limit?: number }): Promise<SenkuroImportResult>;
  /** Subscribe to import progress; returns an unsubscribe function. */
  onSenkuroImportProgress(cb: (p: SenkuroImportProgress) => void): () => void;
  /** New Tor circuit (NEWNYM) without restarting the daemon: the exit IP a site
   * sees changes, which lifts per-IP rate limits (e.g. E-Hentai). */
  newTorCircuit(): Promise<{ ok: boolean }>;
  checkBridges(lines: string[]): Promise<BridgeStatus[]>;
  checkSites(): Promise<SiteStatus[]>;
  libMirrorsCheck(): Promise<LibMirrorStatus[]>;
  customDnsCheck(): Promise<CustomDnsStatus[]>;
  getExAccounts(): Promise<ExAccountsResult>;
  setExAccount(id: number): Promise<ExAccountsResult>;
  addExAccount(name: string, memberId: string, passHash: string, igneous: string): Promise<ExAccountsResult>;
  removeExAccount(id: number): Promise<ExAccountsResult>;
  importExAccounts(): Promise<ImportAccountsResult | null>;
  markChapterRead(url: string): Promise<void>;
  /** Manual toggle: mark a chapter read/unread in settings.read_chapters. */
  setChapterRead(url: string, read: boolean): Promise<void>;
  downloadsList(): Promise<DownloadTask[]>;
  downloadsAdd(sourceUrl: string): Promise<DownloadTask | null>;
  downloadsPause(id: string): Promise<void>;
  downloadsResume(id: string): Promise<void>;
  downloadsRemove(id: string): Promise<void>;
  downloadsSetPriority(id: string, priority: number): Promise<void>;
  downloadsOpen(id: string): Promise<OpenFolderResult | null>;
  downloadsCheckUpdates(): Promise<string[]>;
  downloadsCheckChapters(): Promise<string[]>;
  downloadsPickDir(): Promise<string | null>;
  ehArchiveCost(url: string): Promise<ArchiveCost | null>;
  ehArchiveBuy(url: string, dltype: string): Promise<{ downloadUrl: string } | null>;
  downloadsAddArchive(sourceUrl: string, title: string, downloadUrl: string): Promise<DownloadTask | null>;
  ehLimitsState(): Promise<EhLimitState>;
  pinHasPin(): Promise<boolean>;
  /** `current` is required when a PIN already exists: the main process verifies
   * it itself instead of trusting the settings UI. */
  pinSetPin(pin: string, current?: string): Promise<void>;
  pinRemovePin(pin: string): Promise<boolean>;
  pinVerifyPin(pin: string): Promise<boolean>;
  pinFailedAttempt(): Promise<PinAttemptResult>;
  onEhLimitsChanged(cb: (state: EhLimitState) => void): () => void;
  onDownloadsChanged(cb: (tasks: DownloadTask[]) => void): () => void;
  /** Background enrichment: page counts for nhentai catalog cards arrive one by one. */
  onNhentaiCounts(cb: (entries: { url: string; pages: number }[]) => void): () => void;
  libraryList(query: LibraryQuery): Promise<LibraryItem[]>;
  libraryGet(key: string): Promise<LibraryItem | null>;
  libraryStatuses(urls: string[]): Promise<Record<string, ReadingStatus>>;
  coverCacheInfo(): Promise<{ files: number; bytes: number; maxBytes: number }>;
  coverCacheClear(): Promise<void>;
  libraryAdd(entry: {
    url: string;
    title: string;
    coverUrl: string | null;
    source: string;
    seriesId: string;
    category?: string;
    kind?: string | null;
    adult?: boolean;
  }): Promise<LibraryItem>;
  libraryLookup(url: string, seriesId: string): Promise<{ key: string; favorited: boolean; status: ReadingStatus | null } | null>;
  librarySetFavorite(key: string, at: number | null): Promise<void>;
  libraryAddFavorite(entry: {
    url: string;
    title: string;
    coverUrl: string | null;
    source: string;
    seriesId: string;
    category?: string;
    kind?: string | null;
  }): Promise<LibraryItem>;
  librarySetStatusFor(
    entry: {
      url: string;
      title: string;
      coverUrl: string | null;
      source: string;
      seriesId: string;
      category?: string;
      kind?: string | null;
    },
    status: ReadingStatus,
  ): Promise<LibraryItem>;
  librarySetStatus(key: string, status: ReadingStatus | null): Promise<void>;
  librarySetNote(key: string, note: string): Promise<void>;
  librarySetRating(key: string, rating: number | null): Promise<void>;
  librarySetTags(key: string, tags: string[]): Promise<void>;
  libraryRemove(key: string): Promise<void>;
  libraryDelete(key: string): Promise<void>;
  libraryCounts(): Promise<Record<string, number>>;
  backupExport(includeSecrets: boolean): Promise<{ canceled: boolean; path?: string }>;
  backupImport(): Promise<BackupSummary | null>;
  googleAuthStatus(): Promise<GoogleAuthStatus>;
  googleLogin(): Promise<GoogleAuthStatus>;
  googleLogout(): Promise<void>;
  syncNow(): Promise<SyncState>;
  syncGetState(): Promise<SyncState>;
  onSyncChanged(cb: (s: SyncState) => void): () => void;
  onLibraryChanged(cb: () => void): () => void;
  onSettingsChanged(cb: (s: Settings) => void): () => void;
}

export const CH = {
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  pickFolder: 'folder:pick',
  openFolder: 'folder:open',
  rescanFolder: 'folder:rescan',
  getHistory: 'history:get',
  recordProgress: 'history:progress',
  setSeriesProgress: 'history:seriesProgress',
  clearHistory: 'history:clear',
  openUrl: 'url:open',
  fetchChapterList: 'manga:chapters',
  catalogTags: 'catalog:tags',
  catalogAdultBatch: 'catalog:adult-batch',
  searchCatalog: 'catalog:search',
  catalogPopular: 'catalog:popular',
  loginSite: 'login:site',
  loginPassword: 'ex:passwordlogin',
  cookieLogin: 'ex:cookielogin',
  refreshIgneous: 'ex:refreshingenous',
  parseCookieText: 'ex:parsecookie',
  clearSiteCookies: 'ex:clearcookies',
  setReadingPosition: 'reader:position',
  ehTagSuggest: 'tags:eh',
  catalogSuggest: 'catalog:suggest',
  nhentaiTagSuggest: 'tags:nhentai',
  checkTor: 'tor:check',
  ehResetImageLimit: 'eh:resetImageLimit',
  ehTorrents: 'eh:torrents',
  ehGalleryInfo: 'eh:galleryInfo',
  ehFavorites: 'eh:favorites',
  ehHathDownload: 'eh:hathDownload',
  senkuroLabels: 'senkuro:labels',
  torDiagnostics: 'tor:diagnostics',
  senkuroImport: 'senkuro:import',
  senkuroImportProgress: 'senkuro:import:progress',
  newTorCircuit: 'tor:newCircuit',
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
  setChapterRead: 'reader:setread',
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
} as const;

export type { MangaCard, DownloadTask };