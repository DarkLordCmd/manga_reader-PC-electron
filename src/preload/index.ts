import { contextBridge, ipcRenderer } from 'electron'
import { CH, type Api } from '@shared/ipc'
import type { DownloadTask } from '@shared/downloads'
import type { EhLimitState } from '@shared/ipc'

const api: Api = {
  getSettings: () => ipcRenderer.invoke(CH.getSettings),
  setSettings: (s) => ipcRenderer.invoke(CH.setSettings, s),
  pickFolder: () => ipcRenderer.invoke(CH.pickFolder),
  openFolder: (path) => ipcRenderer.invoke(CH.openFolder, path),
  rescanFolder: (path) => ipcRenderer.invoke(CH.rescanFolder, path),
  getHistory: () => ipcRenderer.invoke(CH.getHistory),
  recordProgress: (url, page, total) => ipcRenderer.invoke(CH.recordProgress, url, page, total),
  clearHistory: () => ipcRenderer.invoke(CH.clearHistory),
  openUrl: (url, startPage, mangaId, coverUrl) => ipcRenderer.invoke(CH.openUrl, url, startPage, mangaId, coverUrl),
  fetchChapterList: (mangaId) => ipcRenderer.invoke(CH.fetchChapterList, mangaId),
  searchCatalog: (source, query, page, sort, filters, cursor) => ipcRenderer.invoke(CH.searchCatalog, source, query, page, sort, filters, cursor),
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
  }
}

contextBridge.exposeInMainWorld('api', api)