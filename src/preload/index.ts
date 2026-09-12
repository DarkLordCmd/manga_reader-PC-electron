import { contextBridge, ipcRenderer } from 'electron'
import { CH, type Api } from '@shared/ipc'

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
  markChapterRead: (url) => ipcRenderer.invoke(CH.markChapterRead, url)
}

contextBridge.exposeInMainWorld('api', api)