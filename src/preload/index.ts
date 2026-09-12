import { contextBridge, ipcRenderer } from 'electron'
import { CH, type Api } from '@shared/ipc'

const api: Api = {
  getSettings: () => ipcRenderer.invoke(CH.getSettings),
  setSettings: (s) => ipcRenderer.invoke(CH.setSettings, s),
  pickFolder: () => ipcRenderer.invoke(CH.pickFolder),
  openFolder: (path) => ipcRenderer.invoke(CH.openFolder, path),
  getHistory: () => ipcRenderer.invoke(CH.getHistory),
  recordProgress: (url, page, total) => ipcRenderer.invoke(CH.recordProgress, url, page, total)
}

contextBridge.exposeInMainWorld('api', api)