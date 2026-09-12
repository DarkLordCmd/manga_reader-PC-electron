import { app, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { SettingsService } from './services/settings'
import { HistoryManager } from './services/history'
import { galleryFromFolder, type Gallery } from './services/gallery'
import { resolveAtHome, fetchChapterList, searchMangaDex } from './services/mangadex'
import { createOnlineGallery, requestPage, setReadingPosition, getGalleryPages } from './services/online-gallery'
import { CH } from '@shared/ipc'

const galleries = new Map<string, Gallery>()
const onlineHeaders = new Map<string, Record<string, string>>()
const coverCache = new Map<string, Buffer>()
const coverInFlight = new Map<string, Promise<Buffer>>()

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

function isUuid(s: string): boolean {
  return s.length === 36 && [...s].every((c, i) =>
    (i === 8 || i === 13 || i === 18 || i === 23) ? c === '-' : /[0-9a-fA-F]/.test(c))
}

function extractMangaDexChapterId(url: string): string | null {
  const t = url.trim()
  if (t.includes('mangadex.org')) {
    const pos = t.indexOf('/chapter/')
    if (pos >= 0) {
      const seg = t.slice(pos + '/chapter/'.length).split('/')[0]
      if (seg) return seg
    }
  }
  if (isUuid(t)) return t
  return null
}

async function fetchCoverBuffer(url: string): Promise<Buffer> {
  const cached = coverCache.get(url)
  if (cached) return cached
  const inFlight = coverInFlight.get(url)
  if (inFlight) return inFlight
  const p = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://mangadex.org/'
        },
        signal: controller.signal
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      coverCache.set(url, buf)
      return buf
    } finally {
      clearTimeout(timer)
      coverInFlight.delete(url)
    }
  })()
  coverInFlight.set(url, p)
  return p
}

app.whenReady().then(() => {
  settings = new SettingsService(app.getPath('userData'))
  history = new HistoryManager()
  history.load(settings.get().viewing_history)

  protocol.handle('manga', async (request) => {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (url.hostname === 'cover') {
      const encoded = parts[0]
      if (!encoded) return new Response('Not found', { status: 404 })
      const target = decodeURIComponent(encoded)
      try {
        const buf = await fetchCoverBuffer(target)
        return new Response(Uint8Array.from(buf), { headers: { 'Content-Type': 'image/jpeg' } })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    }

    const gid = url.hostname
    const index = Number(parts[0])
    const local = galleries.get(gid)
    if (local) {
      if (!Number.isInteger(index) || index < 0 || index >= local.pages.length) {
        return new Response('Not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(local.pages[index]).toString())
    }

    const info = getGalleryPages(gid)
    if (!info) return new Response('Not found', { status: 404 })
    if (!Number.isInteger(index) || index < 0 || index >= info.pageCount) {
      return new Response('Not found', { status: 404 })
    }
    try {
      const buf = await requestPage(gid, index, onlineHeaders.get(gid) ?? {})
      if (!buf) return new Response('Not found', { status: 404 })
      return new Response(Uint8Array.from(buf), { headers: { 'Content-Type': 'image/jpeg' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
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
  ipcMain.handle(CH.clearHistory, () => {
    history.clear()
    settings.save({ ...settings.get(), viewing_history: [] })
  })
  ipcMain.handle(CH.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (r.canceled || r.filePaths.length === 0) return null
    return openFolder(r.filePaths[0])
  })
  ipcMain.handle(CH.openFolder, (_e, path: string) => openFolder(path))
  ipcMain.handle(CH.openUrl, async (_e, url: string, startPage?: number) => {
    const chapterId = extractMangaDexChapterId(url)
    if (!chapterId) return null
    const atHome = await resolveAtHome(chapterId)
    const pageUrls = atHome.files.map((f) => `${atHome.baseUrl}/data/${atHome.hash}/${f}`)
    const gid = createOnlineGallery(`MangaDex Chapter ${chapterId}`, pageUrls)
    onlineHeaders.set(gid, { Referer: 'https://mangadex.org/' })
    const title = `MangaDex Chapter ${chapterId}`
    history.addOrUpdate({
      url: url.trim(), series_id: url.trim(), title,
      cover_url: null, source: 'MangaDex', chapter_label: null,
      chapter_index: null, chapter_total: null, total_pages: pageUrls.length,
      category: 'main'
    })
    settings.save({ ...settings.get(), viewing_history: history.toVec() })
    if (startPage && startPage > 0 && startPage < pageUrls.length) setReadingPosition(gid, startPage)
    return { id: gid, title, pageCount: pageUrls.length, source: 'MangaDex', url: url.trim() }
  })
  ipcMain.handle(CH.fetchChapterList, async (_e, mangaId: string) => {
    const chapters = await fetchChapterList(mangaId)
    return chapters.map((c) => ({ chapter_id: c.chapter_id, chapter_num: c.chapter_num, title: c.title }))
  })
  ipcMain.handle(CH.searchMangaDex, (_e, query: string, sort: string, page: number) =>
    searchMangaDex(query, sort as any, page))
  ipcMain.handle(CH.setReadingPosition, (_e, gid: string, index: number) => {
    setReadingPosition(gid, index)
  })

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
