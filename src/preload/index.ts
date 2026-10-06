import { contextBridge, ipcRenderer } from 'electron'
import { CH, type Api } from '@shared/ipc'
import type { DownloadTask } from '@shared/downloads'
import type { EhLimitState } from '@shared/ipc'
import type { Settings } from '@shared/settings'

const api: Api = {
  getSettings: () => ipcRenderer.invoke(CH.getSettings),
  setSettings: (s) => ipcRenderer.invoke(CH.setSettings, s),
  pickFolder: () => ipcRenderer.invoke(CH.pickFolder),
  openFolder: (path) => ipcRenderer.invoke(CH.openFolder, path),
  rescanFolder: (path) => ipcRenderer.invoke(CH.rescanFolder, path),
  getHistory: () => ipcRenderer.invoke(CH.getHistory),
  recordProgress: (url, page, total) => ipcRenderer.invoke(CH.recordProgress, url, page, total),
  clearHistory: () => ipcRenderer.invoke(CH.clearHistory),
  openUrl: (url, startPage, mangaId, coverUrl, kind) => ipcRenderer.invoke(CH.openUrl, url, startPage, mangaId, coverUrl, kind),
  fetchChapterList: (mangaId) => ipcRenderer.invoke(CH.fetchChapterList, mangaId),
  searchCatalog: (source, query, page, sort, filters, cursor) => ipcRenderer.invoke(CH.searchCatalog, source, query, page, sort, filters, cursor),
  catalogPopular: (source) => ipcRenderer.invoke(CH.catalogPopular, source),
  loginSite: (url) => ipcRenderer.invoke(CH.loginSite, url),
  loginPassword: (user, pass) => ipcRenderer.invoke(CH.loginPassword, user, pass),
  cookieLogin: (input) => ipcRenderer.invoke(CH.cookieLogin, input),
  refreshIgneous: () => ipcRenderer.invoke(CH.refreshIgneous),
  parseCookieText: (text) => ipcRenderer.invoke(CH.parseCookieText, text),
  setReadingPosition: (id, index) => ipcRenderer.invoke(CH.setReadingPosition, id, index),
  ehTagSuggest: (text) => ipcRenderer.invoke(CH.ehTagSuggest, text),
  nhentaiTagSuggest: (text) => ipcRenderer.invoke(CH.nhentaiTagSuggest, text),
  checkTor: () => ipcRenderer.invoke(CH.checkTor),
  checkBridges: (lines) => ipcRenderer.invoke(CH.checkBridges, lines),
  checkSites: () => ipcRenderer.invoke(CH.checkSites),
  libMirrorsCheck: () => ipcRenderer.invoke(CH.libMirrorsCheck),
  customDnsCheck: () => ipcRenderer.invoke(CH.customDnsCheck),
  getExAccounts: () => ipcRenderer.invoke(CH.getExAccounts),
  setExAccount: (id) => ipcRenderer.invoke(CH.setExAccount, id),
  addExAccount: (name, memberId, passHash, igneous) => ipcRenderer.invoke(CH.addExAccount, name, memberId, passHash, igneous),
  removeExAccount: (id) => ipcRenderer.invoke(CH.removeExAccount, id),
  importExAccounts: () => ipcRenderer.invoke(CH.importExAccounts),
  markChapterRead: (url) => ipcRenderer.invoke(CH.markChapterRead, url),
  downloadsList: () => ipcRenderer.invoke(CH.downloadsList),
  downloadsAdd: (sourceUrl) => ipcRenderer.invoke(CH.downloadsAdd, sourceUrl),
  downloadsPause: (id) => ipcRenderer.invoke(CH.downloadsPause, id),
  downloadsResume: (id) => ipcRenderer.invoke(CH.downloadsResume, id),
  downloadsRemove: (id) => ipcRenderer.invoke(CH.downloadsRemove, id),
  downloadsSetPriority: (id, p) => ipcRenderer.invoke(CH.downloadsSetPriority, id, p),
  downloadsOpen: (id) => ipcRenderer.invoke(CH.downloadsOpen, id),
  downloadsCheckUpdates: () => ipcRenderer.invoke(CH.downloadsCheckUpdates),
  downloadsCheckChapters: () => ipcRenderer.invoke(CH.downloadsCheckChapters),
  downloadsPickDir: () => ipcRenderer.invoke(CH.downloadsPickDir),
  ehArchiveCost: (url) => ipcRenderer.invoke(CH.ehArchiveCost, url),
  ehArchiveBuy: (url, dltype) => ipcRenderer.invoke(CH.ehArchiveBuy, url, dltype),
  downloadsAddArchive: (sourceUrl, title, downloadUrl) => ipcRenderer.invoke(CH.downloadsAddArchive, sourceUrl, title, downloadUrl),
  ehLimitsState: () => ipcRenderer.invoke(CH.ehLimitsState),
  pinHasPin: () => ipcRenderer.invoke(CH.pinHasPin),
  pinSetPin: (pin) => ipcRenderer.invoke(CH.pinSetPin, pin),
  pinRemovePin: (pin) => ipcRenderer.invoke(CH.pinRemovePin, pin),
  pinVerifyPin: (pin) => ipcRenderer.invoke(CH.pinVerifyPin, pin),
  pinFailedAttempt: () => ipcRenderer.invoke(CH.pinFailedAttempt),
  onEhLimitsChanged: (cb) => {
    const fn = (_e: unknown, s: EhLimitState): void => cb(s)
    ipcRenderer.on(CH.ehLimitsChanged, fn)
    return () => ipcRenderer.removeListener(CH.ehLimitsChanged, fn)
  },
  onDownloadsChanged: (cb) => {
    const fn = (_e: unknown, tasks: DownloadTask[]): void => cb(tasks)
    ipcRenderer.on(CH.downloadsChanged, fn)
    return () => ipcRenderer.removeListener(CH.downloadsChanged, fn)
  },
  onNhentaiCounts: (cb) => {
    const fn = (_e: unknown, entries: { url: string; pages: number }[]): void => cb(entries)
    ipcRenderer.on(CH.nhentaiCounts, fn)
    return () => ipcRenderer.removeListener(CH.nhentaiCounts, fn)
  },
  libraryList: (query) => ipcRenderer.invoke(CH.libraryList, query),
  libraryGet: (key) => ipcRenderer.invoke(CH.libraryGet, key),
  libraryStatuses: (urls) => ipcRenderer.invoke(CH.libraryStatuses, urls),
  coverCacheInfo: () => ipcRenderer.invoke(CH.coverCacheInfo),
  coverCacheClear: () => ipcRenderer.invoke(CH.coverCacheClear),
  libraryAdd: (entry) => ipcRenderer.invoke(CH.libraryAdd, entry),
  libraryLookup: (url, seriesId) => ipcRenderer.invoke(CH.libraryLookup, url, seriesId),
  librarySetFavorite: (key, at) => ipcRenderer.invoke(CH.librarySetFavorite, key, at),
  libraryAddFavorite: (entry) => ipcRenderer.invoke(CH.libraryAddFavorite, entry),
  librarySetStatusFor: (entry, status) => ipcRenderer.invoke(CH.librarySetStatusFor, entry, status),
  librarySetStatus: (key, status) => ipcRenderer.invoke(CH.librarySetStatus, key, status),
  librarySetNote: (key, note) => ipcRenderer.invoke(CH.librarySetNote, key, note),
  librarySetRating: (key, rating) => ipcRenderer.invoke(CH.librarySetRating, key, rating),
  librarySetTags: (key, tags) => ipcRenderer.invoke(CH.librarySetTags, key, tags),
  libraryRemove: (key) => ipcRenderer.invoke(CH.libraryRemove, key),
  libraryDelete: (key) => ipcRenderer.invoke(CH.libraryDelete, key),
  libraryCounts: () => ipcRenderer.invoke(CH.libraryCounts),
  backupExport: (includeSecrets) => ipcRenderer.invoke(CH.backupExport, includeSecrets),
  backupImport: () => ipcRenderer.invoke(CH.backupImport),
  googleAuthStatus: () => ipcRenderer.invoke(CH.googleAuthStatus),
  googleLogin: () => ipcRenderer.invoke(CH.googleLogin),
  googleLogout: () => ipcRenderer.invoke(CH.googleLogout),
  syncNow: () => ipcRenderer.invoke(CH.syncNow),
  syncGetState: () => ipcRenderer.invoke(CH.syncGetState),
  onSyncChanged: (cb) => {
    const fn = (_e: unknown, s: import('@shared/sync').SyncState): void => cb(s)
    ipcRenderer.on(CH.syncChanged, fn)
    return () => ipcRenderer.removeListener(CH.syncChanged, fn)
  },
  onLibraryChanged: (cb) => {
    const fn = (): void => cb()
    ipcRenderer.on(CH.libraryChanged, fn)
    return () => ipcRenderer.removeListener(CH.libraryChanged, fn)
  },
  onSettingsChanged: (cb) => {
    const fn = (_e: unknown, s: Settings): void => cb(s)
    ipcRenderer.on(CH.settingsChanged, fn)
    return () => ipcRenderer.removeListener(CH.settingsChanged, fn)
  }
}

contextBridge.exposeInMainWorld('api', api)