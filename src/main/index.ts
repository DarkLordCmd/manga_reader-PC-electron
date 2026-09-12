import { app, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { SettingsService } from './services/settings'
import { HistoryManager } from './services/history'
import { galleryFromFolder, type Gallery } from './services/gallery'
import { CH } from '@shared/ipc'

const galleries = new Map<string, Gallery>()

protocol.registerSchemesAsPrivileged([
  { scheme: 'manga', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let settings: SettingsService
let history: HistoryManager

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 480, minHeight: 360,
    backgroundColor: '#000000', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  settings = new SettingsService(app.getPath('userData'))
  history = new HistoryManager()
  history.load(settings.get().viewing_history)

  protocol.handle('manga', (request) => {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    const g = galleries.get(url.hostname)
    const index = Number(parts[0])
    if (!g || !Number.isInteger(index) || index < 0 || index >= g.pages.length) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(g.pages[index]).toString())
  })

  ipcMain.handle(CH.getSettings, () => settings.get())
  ipcMain.handle(CH.setSettings, (_e, s) => {
    settings.save(s)
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.settingsChanged, s)
  })
  ipcMain.handle(CH.getHistory, () => history.toVec())
  ipcMain.handle(CH.recordProgress, (_e, url: string, page: number, total: number) => {
    history.updateProgress(url, page, total)
    settings.save({ ...settings.get(), viewing_history: history.toVec() })
  })
  ipcMain.handle(CH.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (r.canceled || r.filePaths.length === 0) return null
    return openFolder(r.filePaths[0])
  })
  ipcMain.handle(CH.openFolder, (_e, path: string) => openFolder(path))

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

function openFolder(path: string): { id: string; title: string; pageCount: number; pages: string[] } | null {
  const g = galleryFromFolder(path)
  if (!g) return null
  galleries.set(g.id, g)
  const s = settings.get()
  settings.save({ ...s, last_folder: path })
  return { id: g.id, title: g.title, pageCount: g.pages.length, pages: g.pages }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})