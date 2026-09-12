import { contextBridge, ipcRenderer } from 'electron'
import { CH, type Api } from '@shared/ipc'

const api: Api = {
  getSettings: () => ipcRenderer.invoke(CH.getSettings),
  setSettings: (s) => ipcRenderer.invoke(CH.setSettings, s),
  pickFolder: () => ipcRenderer.invoke(CH.pickFolder),
  openFolder: (path) => ipcRenderer.invoke(CH.openFolder, path),
  getHistory: () => ipcRenderer.invoke(CH.getHistory),
  recordProgress: (url, page, total) => ipcRenderer.invoke(CH.recordProgress, url, page, total),
  clearHistory: () => ipcRenderer.invoke(CH.clearHistory),
  openUrl: (url, startPage, mangaId) => ipcRenderer.invoke(CH.openUrl, url, startPage, mangaId),
  fetchChapterList: (mangaId) => ipcRenderer.invoke(CH.fetchChapterList, mangaId),
  searchMangaDex: (query, sort, page) => ipcRenderer.invoke(CH.searchMangaDex, query, sort, page),
  setReadingPosition: (id, index) => ipcRenderer.invoke(CH.setReadingPosition, id, index)
}

contextBridge.exposeInMainWorld('api', api)