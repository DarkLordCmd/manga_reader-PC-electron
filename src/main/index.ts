import { app, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { readFileSync, writeFileSync, copyFileSync } from 'fs'
import { SettingsService } from './services/settings'
import { HistoryManager } from './services/history'
import { openDatabase } from './services/db'
import { LibraryService } from './services/library'
import { galleryFromFolder, type Gallery } from './services/gallery'
import { openZipGallery, readZipEntry, isZipPath, clearZipTmpAll } from './services/zip-gallery'
import { fetchChapterList, searchMangaDex, fetchChapterCount } from './services/mangadex'
import { createOnlineGallery, requestPage, setReadingPosition, getGalleryPages } from './services/online-gallery'
import { resolveGallery, sourceLabel, UnsupportedUrlError, type GalleryResolution } from './services/resolve-gallery'
import {
  fetchRemangaChapters, fetchSenkuroChapters
} from './services/sources'
import { fetchMangaShiChapters } from './services/catalog-search'
import { fetchMangaMelloChapters } from './services/catalog-search'
import { searchGrouple, GROUPLE_SITES, fetchGroupleChapters } from './services/catalog-search'
import type { SimpleSiteConfig } from './services/sources/catalog-types'
import { searchExHentai, searchMangaShi, searchMangaMello, searchNhentai, searchRemanga, searchSenkuro, searchSimpleSite, extractGidToken } from './services/catalog-search'
import { fetchArchiveCost, buyArchive } from './services/eh-archive'
import { runLoginWindow } from './services/login'
import { probeSocks5Handshake, probeBridgeLine, probeSite, allSiteKeys } from './services/tor-check'
import { fetchEhTagSuggest, fetchNhentaiTagSuggestions } from './services/tags'
import { fetchCoverBuffer } from './services/covers'
import { setFrontingEnabled } from './services/domain-fronting'
import { setTorFallbackAddr } from './services/http'
import { shutdownBrowserFetch } from './services/browser-fetch'
import { parseMangaPageUrl } from './services/page-url'
import { ExAccountsService, parseCookieLogin } from './services/accounts'
import { setEhSetCookieHandler } from './services/eh-session'
import { PinService } from './services/pin'
import { ehWatcher, broadcastEhLimitState } from './services/eh-limits-instance'
import { registerEhLimitHook } from './services/eh-limits-hook'
import { httpFetchBinary, httpFetch } from './services/http'
import { setLibMirror, LIB_MIRRORS } from './services/lib-mirror'
import { setCustomDnsServers, parseDnsServerList, checkCustomDns } from './services/custom-dns'
import { initCookieStore } from './services/comx-gate'
import { lookup as dnsPromiseLookup } from 'dns'
import { DownloadManager } from './services/download-manager'
import { buildBackup, parseBackup, SECRET_SETTINGS } from './services/backup'
import { GoogleAuth } from './services/google-auth'
import { GoogleDrive } from './services/google-drive'
import { SyncService } from './services/sync'
import { isPortableSettingsChanged } from './services/sync'
import { CH } from '@shared/ipc'

const galleries = new Map<string, Gallery>()
const onlineHeaders = new Map<string, Record<string, string>>()
const coverCache = new Map<string, Buffer>()
const coverInFlight = new Map<string, Promise<Buffer>>()
const zipMeta = new Map<string, { zipPath: string; entries: string[] }>()
const ZIP_TMP = join(app.getPath('userData'), 'tmp', 'zip')
const SERIES_SOURCES = ['MangaDex', 'Remanga', 'Senkuro', 'Manga-shi', 'Readmanga', 'Mintmanga', 'Mangapoisk', 'MangaMello']

function downloadsDirBase(dir: string | null | undefined): string {
  return dir?.trim() || join(app.getPath('userData'), 'downloads')
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'manga', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let settings: SettingsService
let history: HistoryManager
let library: LibraryService
let exAccounts: ExAccountsService
let downloads: DownloadManager
let pin: PinService
let sync: SyncService

function downloadFetchOpts(sourceUrl: string): { proxy?: string; cookieHeader?: string } {
  const s = settings.get()
  const torSocks = s.tor_socks_addr || '127.0.0.1:9150'
  const isEx = sourceUrl.includes('exhentai') || sourceUrl.includes('e-hentai.org')
  const useTor = sourceUrl.includes('.onion') || (isEx && (s.tor_proxied_sites.includes('ehentai') || s.tor_proxied_sites.includes('exhentai')))
  const proxy = useTor ? torSocks : (isEx && s.exhentai_proxy_addr.trim() ? s.exhentai_proxy_addr.trim() : undefined)
  const cookieHeader = sourceUrl.includes('.onion') ? s.onion_cookies_raw : isEx ? exAccounts.currentCookieHeader() : undefined
  return { proxy, cookieHeader }
}

function getCover(url: string): Promise<Buffer> {
  const cached = coverCache.get(url)
  if (cached) return Promise.resolve(cached)
  const inFlight = coverInFlight.get(url)
  if (inFlight) return inFlight
  const p = (async () => {
    try {
      const buf = await fetchCoverBuffer(url, settings.get(), exAccounts.currentCookieHeader())
      coverCache.set(url, buf)
      return buf
    } finally {
      coverInFlight.delete(url)
    }
  })()
  coverInFlight.set(url, p)
  return p
}

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
  setFrontingEnabled(settings.get().enable_domain_fronting)
  setTorFallbackAddr(settings.get().tor_socks_addr || '127.0.0.1:9150')
  setLibMirror(settings.get().lib_image_server ?? null)
  setCustomDnsServers(parseDnsServerList(settings.get().custom_dns ?? ''))
  initCookieStore(app.getPath('userData'))
  pin = new PinService(app.getPath('userData'))
  ipcMain.handle(CH.pinHasPin, () => pin.hasPin())
  ipcMain.handle(CH.pinSetPin, (_e, p: string) => pin.setPin(String(p)))
  ipcMain.handle(CH.pinRemovePin, (_e, p: string) => pin.removePin(String(p)))
  ipcMain.handle(CH.pinVerifyPin, (_e, p: string) => pin.verify(String(p)))
  ipcMain.handle(CH.pinFailedAttempt, () => pin.failedAttempt())
  exAccounts = new ExAccountsService(app.getPath('userData'))
  exAccounts.init()
  registerEhLimitHook({
    watcher: ehWatcher,
    switchAccount: () => {
      const accs = exAccounts.accounts
      if (accs.length === 0) return false
      const idx = accs.findIndex((a) => a.id === exAccounts.currentId)
      const next = accs[(idx + 1) % accs.length] ?? accs[0]
      if (!next || next.id === exAccounts.currentId) return false
      exAccounts.setCurrent(next.id)
      return true
    }
  })
  ehWatcher.onChange(broadcastEhLimitState)
  ipcMain.handle(CH.ehLimitsState, () => ehWatcher.state())
  setEhSetCookieHandler((_host, setCookies) => exAccounts.mergeSetCookies(setCookies))
  const { db, repo } = openDatabase(app.getPath('userData'))
  history = new HistoryManager(repo)
  history.load(settings.get().viewing_history)
  library = new LibraryService(repo, { autoAdd: () => settings.get().library_auto_add })

  const googleAuth = new GoogleAuth(app.getPath('userData'))
  const googleDrive = new GoogleDrive(googleAuth)
  const syncStatePath = join(app.getPath('userData'), 'sync-state.json')
  let settingsUpdatedAt = Date.now()
  try { settingsUpdatedAt = JSON.parse(readFileSync(syncStatePath, 'utf8')).settingsUpdatedAt ?? settingsUpdatedAt } catch { /* ignore */ }
  const persistSyncState = (): void => { try { writeFileSync(syncStatePath, JSON.stringify({ settingsUpdatedAt })) } catch { /* ignore */ } }
  sync = new SyncService({
    repo,
    getSettings: () => settings.get(),
    saveSettings: (s) => { settings.save(s); for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.settingsChanged, s) },
    getSettingsUpdatedAt: () => settingsUpdatedAt,
    setSettingsUpdatedAt: (t) => { settingsUpdatedAt = t; persistSyncState() },
    isEnabled: () => settings.get().sync_auto && settings.get().sync_enabled,
    onImported: () => broadcastLibrary(),
    drive: googleDrive,
    authStatus: () => googleAuth.status(),
    onChanged: (st) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.syncChanged, st) }
  })
  ipcMain.handle(CH.googleAuthStatus, () => googleAuth.status())
  ipcMain.handle(CH.googleLogin, async () => { const r = await googleAuth.login(); return googleAuth.status() })
  ipcMain.handle(CH.googleLogout, async () => { await googleAuth.logout() })
  ipcMain.handle(CH.syncNow, () => sync!.syncNow())
  ipcMain.handle(CH.syncGetState, () => sync!.getState())
  if (googleAuth.status().authed) {
    setTimeout(() => { sync?.scheduleSync() }, 3000)
  }

  downloads = new DownloadManager(
    downloadsDirBase(settings.get().downloads_dir),
    join(app.getPath('userData'), 'downloads.json'),
    {
      fetchBinary: (url, headers, proxy, timeoutMs) => httpFetchBinary(url, headers ?? {}, proxy, timeoutMs),
      broadcast: (tasks) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.downloadsChanged, tasks) }
    }
  )

  ipcMain.handle(CH.downloadsList, () => downloads.list())
  ipcMain.handle(CH.downloadsAdd, async (_e, sourceUrl: string) => {
    const { proxy, cookieHeader } = downloadFetchOpts(sourceUrl)
    const holder: { res: GalleryResolution | null } = { res: null }
    const task = await downloads.add(sourceUrl, async () => {
      holder.res = await resolveGallery(sourceUrl, { proxy, cookieHeader })
      return holder.res
    }, {
      Referer: sourceUrl,
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    }, proxy)
    if (task && holder.res) {
      const mangaId = holder.res.mangaId
      if (mangaId && SERIES_SOURCES.includes(sourceLabel(sourceUrl))) {
        downloads.setChapterMeta(task.id, { mangaId })
        const count = await fetchChapterCountSafe(mangaId)
        if (count != null) downloads.setChapterMeta(task.id, { chapterTotal: count })
      }
    }
    return task
  })

  async function fetchChapterListFor(mangaId: string): Promise<{ chapter_id: string; chapter_num: string; title: string | null }[]> {
    let chapters
    if (mangaId.includes('remanga.org')) {
      chapters = await fetchRemangaChapters(mangaId)
    } else if (mangaId.includes('senkuro')) {
      const slug = mangaId.trim().replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? mangaId
      chapters = await fetchSenkuroChapters(slug, settings.get().onion_cookies_raw)
    } else if (mangaId.includes('manga-shi')) {
      const s = settings.get()
      const proxy = s.tor_proxied_sites.includes('mangashi') ? (s.tor_socks_addr || '127.0.0.1:9150') : undefined
      chapters = await fetchMangaShiChapters(mangaId, proxy)
    } else if (mangaId.includes('mangamello')) {
      chapters = await fetchMangaMelloChapters(mangaId)
    } else if (mangaId.includes('readmanga.') || mangaId.includes('mintmanga.') || mangaId.includes('mangapoisk.')) {
      chapters = await fetchGroupleChapters(mangaId)
    } else if (mangaId.includes('com-x.life')) {
      const { fetchComxChapters } = await import('./services/sources/comx')
      chapters = await fetchComxChapters(mangaId)
    } else {
      chapters = await fetchChapterList(mangaId)
    }
    return chapters.map((c) => ({ chapter_id: c.chapter_id, chapter_num: c.chapter_num, title: c.title }))
  }

  async function fetchChapterListSafe(mangaId: string): Promise<{ chapter_id: string; chapter_num: string; title: string | null }[] | null> {
    try { return await fetchChapterListFor(mangaId) } catch { return null }
  }

  async function fetchChapterCountSafe(mangaId: string): Promise<number | null> {
    const list = await fetchChapterListSafe(mangaId)
    return list ? list.length : null
  }

  ipcMain.handle(CH.downloadsCheckChapters, async () => {
    const updated: string[] = []
    for (const t of downloads.list()) {
      if (!t.mangaId || t.chapterTotal == null) continue
      const list = await fetchChapterListSafe(t.mangaId)
      if (!list) continue
      if (list.length > t.chapterTotal) {
        downloads.setChapterMeta(t.id, {
          newChapters: list.length - t.chapterTotal,
          latestChapterId: list[list.length - 1].chapter_id
        })
        updated.push(t.id)
      }
    }
    return updated
  })
  ipcMain.handle(CH.downloadsPause, (_e, id: string) => downloads.pause(id))
  ipcMain.handle(CH.downloadsResume, (_e, id: string) => downloads.resume(id))
  ipcMain.handle(CH.downloadsRemove, (_e, id: string) => downloads.remove(id))
  ipcMain.handle(CH.downloadsSetPriority, (_e, id: string, p: number) => downloads.setPriority(id, p))
  ipcMain.handle(CH.downloadsOpen, (_e, id: string) => {
    const t = downloads.list().find((x) => x.id === id)
    if (!t || t.state !== 'completed') return null
    const g = galleryFromFolder(t.outDir)
    if (!g) return null
    galleries.set(g.id, g)
    return { id: g.id, title: g.title, pageCount: g.pages.length, pages: g.pages, url: `file://${t.outDir}` }
  })
  ipcMain.handle(CH.downloadsCheckUpdates, async () => {
    const urls = downloads.list().filter((t) => t.state === 'completed').map((t) => t.sourceUrl)
    return await downloads.checkUpdates(urls, async (url) => {
      const { proxy, cookieHeader } = downloadFetchOpts(url)
      return await resolveGallery(url, { proxy, cookieHeader })
    })
  })

  function archiverUrlFor(galleryUrl: string): string | null {
    const gt = extractGidToken(galleryUrl)
    if (!gt) return null
    const base = new URL(galleryUrl)
    return `${base.origin}/archiver.php?gid=${gt.gid}&token=${gt.token}`
  }
  ipcMain.handle(CH.ehArchiveCost, async (_e, url: string) => {
    const archiver = archiverUrlFor(url)
    if (!archiver) return null
    const { proxy, cookieHeader } = downloadFetchOpts(url)
    try {
      return await fetchArchiveCost(archiver, { cookieHeader, proxy })
    } catch { return null }
  })
  ipcMain.handle(CH.ehArchiveBuy, async (_e, url: string, dltype: string) => {
    const archiver = archiverUrlFor(url)
    if (!archiver) return null
    const { proxy, cookieHeader } = downloadFetchOpts(url)
    try {
      return await buyArchive(archiver, { cookieHeader, proxy, dltype })
    } catch { return null }
  })
  ipcMain.handle(CH.downloadsAddArchive, (_e, sourceUrl: string, title: string, downloadUrl: string) => {
    const { proxy, cookieHeader } = downloadFetchOpts(sourceUrl)
    return downloads.addArchive(sourceUrl, title, downloadUrl, {
      Referer: new URL(sourceUrl).origin + '/',
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    }, proxy)
  })

  ipcMain.handle(CH.backupExport, async (_e, includeSecrets: boolean) => {
    const r = await dialog.showSaveDialog({
      title: 'Экспорт данных',
      defaultPath: `manga-reader-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return { canceled: true }
    const data = buildBackup(
      settings.get(),
      repo.all(),
      exAccounts.accounts,
      downloads.list(),
      !!includeSecrets
    )
    writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf8')
    return { canceled: false, path: r.filePath }
  })

  ipcMain.handle(CH.backupImport, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Импорт данных',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (r.canceled || r.filePaths.length === 0) return null
    let backup
    try {
      backup = parseBackup(readFileSync(r.filePaths[0], 'utf8'))
    } catch (e: any) {
      dialog.showErrorBox('Импорт не выполнен', e?.message ?? String(e))
      return null
    }
    // WAL-safe safety copy: checkpoint first so all committed data is in the
    // main file, then copy just that file.
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignore */ }
    try { copyFileSync(join(app.getPath('userData'), 'library.db'), join(app.getPath('userData'), 'library.db.bak')) } catch { /* ignore */ }

    try {
      const res = repo.importItems(backup.series ?? [])

      const next = { ...settings.get(), ...backup.settings }
      for (const k of SECRET_SETTINGS) {
        if (String((backup.settings as any)[k] ?? '') === '') (next as any)[k] = (settings.get() as any)[k]
      }
      settings.save(next)
      setFrontingEnabled(!!next.enable_domain_fronting)
      setLibMirror(next.lib_image_server ?? null)
      setCustomDnsServers(parseDnsServerList(next.custom_dns ?? ''))

      const accountsAdded = Array.isArray(backup.accounts) ? exAccounts.importAccounts(backup.accounts) : 0

      let downloadsMerged = 0
      const existing = new Set(downloads.list().map((t) => t.sourceUrl))
      for (const t of backup.downloads ?? []) {
        if (existing.has(t.sourceUrl)) continue
        downloads.adopt(t)
        existing.add(t.sourceUrl)
        downloadsMerged++
      }

      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.libraryChanged)
      const summary: import('@shared/ipc').BackupSummary = {
        seriesAdded: res.added, seriesUpdated: res.updated, accountsAdded, downloadsMerged
      }
      return summary
    } catch (e: any) {
      dialog.showErrorBox('Импорт не выполнен', e?.message ?? String(e))
      return null
    }
  })

  protocol.handle('manga', async (request) => {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (url.hostname === 'cover') {
      const encoded = parts[0]
      if (!encoded) return new Response('Not found', { status: 404 })
      const target = decodeURIComponent(encoded)
      try {
        const buf = await getCover(target)
        return new Response(Uint8Array.from(buf), { headers: { 'Content-Type': 'image/jpeg' } })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    }

    // Renderer requests pages as `manga://page/<galleryId>/<index>`, so the
    // gallery id lives in the first path segment when hostname is "page".
    const parsed = parseMangaPageUrl(request.url)
    if (!parsed) return new Response('Not found', { status: 404 })
    const gid = parsed.gid
    const index = parsed.index

    const zip = zipMeta.get(gid)
    if (zip) {
      if (!Number.isInteger(index) || index < 0 || index >= zip.entries.length) {
        return new Response('Not found', { status: 404 })
      }
      let file: string
      try {
        file = await readZipEntry(zip.zipPath, zip.entries[index], ZIP_TMP)
      } catch {
        return new Response('Not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(file).toString())
    }

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
    setFrontingEnabled(!!s?.enable_domain_fronting)
    setTorFallbackAddr(s?.tor_socks_addr || '127.0.0.1:9150')
    setLibMirror(s?.lib_image_server ?? null)
    setCustomDnsServers(parseDnsServerList(s?.custom_dns ?? ''))
    const prevSettings = settings.get()
    const before = downloadsDirBase(prevSettings.downloads_dir)
    settings.save(s)
    const after = downloadsDirBase(s?.downloads_dir)
    if (before !== after) downloads.setOutDirBase(after)
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.settingsChanged, s)
    if (isPortableSettingsChanged(prevSettings, s)) {
      sync?.markSettingsChanged()
      sync?.scheduleSync()
    }
  })
  ipcMain.handle(CH.getHistory, () => history.toVec())

  function broadcastLibrary(): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.libraryChanged)
    sync?.scheduleSync()
  }

  ipcMain.handle(CH.libraryList, (_e, query) => library.list(query ?? {}))
  ipcMain.handle(CH.libraryGet, (_e, key: string) => library.get(String(key)))
  ipcMain.handle(CH.libraryAdd, (_e, entry) => {
    const item = library.addFromCatalog(entry)
    broadcastLibrary()
    return item
  })
  ipcMain.handle(CH.librarySetStatus, (_e, key: string, status: any) => { library.setStatus(String(key), status); broadcastLibrary() })
  ipcMain.handle(CH.librarySetNote, (_e, key: string, note: string) => { library.setNote(String(key), String(note ?? '')); broadcastLibrary() })
  ipcMain.handle(CH.librarySetRating, (_e, key: string, rating: number | null) => { library.setRating(String(key), rating); broadcastLibrary() })
  ipcMain.handle(CH.librarySetTags, (_e, key: string, tags: string[]) => { library.setTags(String(key), Array.isArray(tags) ? tags : []); broadcastLibrary() })
  ipcMain.handle(CH.libraryRemove, (_e, key: string) => { library.removeFromLibrary(String(key)); broadcastLibrary() })
  ipcMain.handle(CH.libraryDelete, (_e, key: string) => { library.deleteSeries(String(key)); broadcastLibrary() })
  ipcMain.handle(CH.libraryCounts, () => library.countByStatus())

  ipcMain.handle(CH.recordProgress, (_e, url: string, page: number, total: number) => {
    history.updateProgress(url, page, total)
    settings.save({ ...settings.get(), viewing_history: history.toVec() })
    sync?.scheduleSync()
  })
  ipcMain.handle(CH.clearHistory, () => {
    history.clear()
    settings.save({ ...settings.get(), viewing_history: [] })
    sync?.scheduleSync()
  })
  ipcMain.handle(CH.downloadsPickDir, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0]
  })
  ipcMain.handle(CH.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'openFile'] })
    if (r.canceled || r.filePaths.length === 0) return null
    return openFolder(r.filePaths[0])
  })
  ipcMain.handle(CH.openFolder, (_e, path: string) => openFolder(path))
  ipcMain.handle(CH.openUrl, async (_e, url: string, startPage?: number, mangaId?: string | null, coverUrl?: string | null) => {
    const trimmed = url.trim()
    const s = settings.get()
    const torSocks = s.tor_socks_addr || '127.0.0.1:9150'
    const useTor = url.includes('.onion')
      || (url.includes('nhentai') && s.tor_proxied_sites.includes('nhentai'))
      || (url.includes('e-hentai.org') && s.tor_proxied_sites.includes('ehentai'))
      || (url.includes('exhentai.org') && (s.tor_proxied_sites.includes('ehentai') || s.tor_proxied_sites.includes('exhentai')))
      || (url.includes('com-x.life') && s.tor_proxied_sites.includes('comx'))
      || (url.includes('senkuro') && s.tor_proxied_sites.includes('senkuro'))
      || (url.includes('manga-shi') && s.tor_proxied_sites.includes('mangashi'))
      || (url.includes('remanga') && s.tor_proxied_sites.includes('remanga'))
      || (url.includes('mangalib') && s.tor_proxied_sites.includes('mangalib'))
    let proxy = useTor ? torSocks : undefined
    // Clearnet ExHentai/E-Hentai uses the active account pool cookies and,
    // if configured, the dedicated exhentai_proxy_addr proxy.
    const isClearnetEx = url.includes('exhentai') || url.includes('e-hentai.org')
    const cookieHeader = url.includes('.onion')
      ? s.onion_cookies_raw
      : isClearnetEx
        ? exAccounts.currentCookieHeader()
        : s.onion_cookies_raw
    if (isClearnetEx && !url.includes('.onion') && s.exhentai_proxy_addr.trim()) proxy = s.exhentai_proxy_addr.trim()
    let result: GalleryResolution
    try {
      result = await resolveGallery(trimmed, { proxy, cookieHeader })
    } catch (e) {
      if (e instanceof UnsupportedUrlError) return null
      throw e
    }
    // If no series url was derived, fall back to the caller-provided mangaId (original behavior).
    const seriesId = result.seriesId === trimmed ? (mangaId ?? trimmed) : result.seriesId

    const gid = createOnlineGallery(result.title, result.pageUrls, result.proxy)
    const headers: Record<string, string> = {}
    if (result.referer) headers.Referer = result.referer
    if (cookieHeader && (trimmed.includes('.onion') || trimmed.includes('exhentai') || trimmed.includes('e-hentai.org'))) headers.Cookie = cookieHeader
    onlineHeaders.set(gid, headers)

    history.addOrUpdate({
      url: trimmed, series_id: seriesId, title: result.title,
      cover_url: coverUrl ?? result.coverUrl, source: result.source, chapter_label: null,
      chapter_index: null, chapter_total: null, total_pages: result.pageUrls.length,
      category: trimmed.includes('nhentai') || trimmed.includes('exhentai') || trimmed.includes('e-hentai.org') ? 'r34' : 'main'
    })
    settings.save({ ...settings.get(), viewing_history: history.toVec() })
    library.autoAddIfNeeded(trimmed, seriesId)
    if (startPage && startPage > 0 && startPage < result.pageUrls.length) setReadingPosition(gid, startPage)
    return { id: gid, title: result.title, pageCount: result.pageUrls.length, source: result.source, url: trimmed, mangaId: seriesId }
  })
  ipcMain.handle(CH.fetchChapterList, async (_e, mangaId: string) => {
    return await fetchChapterListFor(mangaId)
  })
  ipcMain.handle(CH.searchCatalog, async (_e, source: string, query: string, page: number, sort: string, filters: any = {}, cursor: any = null) => {
    const s = settings.get()
    const torSocks = s.tor_socks_addr || '127.0.0.1:9150'
    const siteKey = source === 'nhentai_onion' ? 'nhentai' : source
    const proxy = s.tor_proxied_sites.includes(siteKey) || source.endsWith('_onion') ? torSocks : undefined

    if (source === 'mangadex') {
      const cards = await searchMangaDex(query, sort as any, page, filters.mangadexTags ?? [], filters.mangadexLangs ?? [])
      // Fetch chapter counts in the background with limited concurrency
      // (mirrors the original app's async card enrichment).
      const enriched: any[] = []
      let next = 0
      async function worker(): Promise<void> {
        while (next < cards.length) {
          const i = next++
          try {
            const count = await fetchChapterCount(cards[i].manga_id)
            enriched[i] = { ...cards[i], chapterCount: count }
          } catch {
            enriched[i] = cards[i]
          }
        }
      }
      await Promise.all(Array.from({ length: 6 }, () => worker()))
      return enriched.map((c) => ({
        url: c.manga_id, title: c.title, coverUrl: c.cover_url, pages: null,
        kind: c.kind, score: c.score, chapterCount: c.chapterCount ?? null
      }))
    }
    if (source === 'remanga') return await searchRemanga(query, page, filters)
    if (source === 'senkuro') return await searchSenkuro(query, s.onion_cookies_raw, cursor?.dir === 'next' ? cursor.cursor : undefined)
    if (source === 'mangashi') return await searchMangaShi(query, proxy, filters, page)
    if (source === 'mangamello') return await searchMangaMello(query, page)
    if (source === 'nhentai') return await searchNhentai('https://nhentai.net', query, page, { proxy, cookieHeader: s.onion_cookies_raw, showPageCounts: s.nhentai_show_page_counts, tags: filters.nhentaiTags })
    if (source === 'nhentai_onion') {
      const base = s.nhentai_onion_base || 'http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion'
      return await searchNhentai(base, query, page, { proxy: torSocks, cookieHeader: s.nhentai_onion_cookies_raw, showPageCounts: s.nhentai_show_page_counts, tags: filters.nhentaiTags })
    }
    if (source === 'ehentai' || source === 'exhentai' || source === 'exhentai_onion') {
      const useOnion = source === 'exhentai_onion'
      const cookieHeader = useOnion ? s.onion_cookies_raw : exAccounts.currentCookieHeader()
      // The "E-Hentai" Tor toggle routes both e-hentai.org and exhentai.org
      // through Tor (same site family), like the original app.
      const torForEx = s.tor_proxied_sites.includes('ehentai') || s.tor_proxied_sites.includes('exhentai')
      const useTor = useOnion || torForEx
      const exProxy = useTor ? torSocks : (s.exhentai_proxy_addr.trim() || undefined)
      const ex = await searchExHentai(query, {
        cookieHeader,
        torSocksAddr: torSocks,
        useOnion,
        page,
        forceTor: torForEx,
        excludedCats: filters.ehExcludedCats,
        domainOverride: source === 'ehentai' ? 'https://e-hentai.org' : undefined,
        cursor: cursor ? { dir: cursor.dir, gid: cursor.cursor } : undefined
      }, exProxy)
      return ex.map((c) => ({ url: c.url, title: c.title, coverUrl: c.coverUrl, pages: c.pages, score: c.rating, kind: c.category }))
    }
    if (source === 'comx') {
      const { searchComx } = await import('./services/sources/comx')
      const { COMX_BASE } = await import('./services/sources/comx')
      return await searchComx({ name: 'Com-X', base: COMX_BASE, catalogPath: '/comix-read/', searchPath: '/search/', linkMarker: '.html' }, query, page, { proxy })
    }
    if (source === 'mangalib') {
      const cfg = {
        mangalib: { name: 'Mangalib', base: 'https://mangalib.me', catalogPath: '/manga-list', searchPath: '/search?q=', linkMarker: '/manga/' }
      }[source]!
      const extra = page > 0 ? `page=${page + 1}` : ''
      return await searchSimpleSite(cfg, query, extra, { proxy })
    }
    const groupleIdx = { readmanga: 0, mintmanga: 1, mangapoisk: 2 } as const
    if (source in groupleIdx) {
      const cfg = GROUPLE_SITES[groupleIdx[source as keyof typeof groupleIdx]] as SimpleSiteConfig
      return await searchGrouple(cfg, query, page)
    }
    return []
  })
  ipcMain.handle(CH.loginSite, async (_e, url: string) => {
    const s = settings.get()
    const result = await runLoginWindow(url, s.tor_socks_addr || '127.0.0.1:9150')
    if (!result) return null
    // Persist cookies into settings depending on target
    const next = { ...settings.get() }
    if (url.includes('exhentai')) next.onion_cookies_raw = result.cookies
    else if (url.includes('nhentai')) next.nhentai_onion_cookies_raw = result.cookies
    settings.save(next)
    return result.cookies
  })
  ipcMain.handle(CH.loginPassword, async (_e, user: string, pass: string) => {
    const r = await exAccounts.passwordLogin(user, pass)
    if (r.ok) {
      const s = settings.get()
      // Keep the account pool in sync with the cookie header used for clearnet ExHentai.
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.settingsChanged, s)
    }
    return r
  })
  ipcMain.handle(CH.cookieLogin, async (_e, input: any) => {
    return await exAccounts.cookieLogin({
      ipbMemberId: String(input?.ipbMemberId ?? ''),
      ipbPassHash: String(input?.ipbPassHash ?? ''),
      igneous: input?.igneous ?? null,
      verify: input?.verify !== false
    })
  })
  ipcMain.handle(CH.refreshIgneous, async () => await exAccounts.refreshIgneous())
  ipcMain.handle(CH.parseCookieText, (_e, text: string) => parseCookieLogin(String(text ?? '')))
  ipcMain.handle(CH.ehTagSuggest, async (_e, text: string) => {
    const s = settings.get()
    const proxy = s.tor_proxied_sites.includes('ehentai') ? (s.tor_socks_addr || '127.0.0.1:9150') : (s.exhentai_proxy_addr.trim() || undefined)
    return await fetchEhTagSuggest(text, { proxy, cookieHeader: exAccounts.currentCookieHeader() || s.onion_cookies_raw })
  })
  ipcMain.handle(CH.nhentaiTagSuggest, async (_e, text: string) => {
    const s = settings.get()
    const proxy = s.tor_proxied_sites.includes('nhentai') ? (s.tor_socks_addr || '127.0.0.1:9150') : undefined
    return await fetchNhentaiTagSuggestions(text, { proxy })
  })
  ipcMain.handle(CH.checkTor, async () => {
    const s = settings.get()
    return await probeSocks5Handshake(s.tor_socks_addr || '127.0.0.1:9150')
  })
  ipcMain.handle(CH.checkBridges, async (_e, lines: string[]) => {
    return await Promise.all(lines.map((line) => probeBridgeLine(line)))
  })
  ipcMain.handle(CH.checkSites, async () => {
    const s = settings.get()
    const torAddr = s.tor_socks_addr || '127.0.0.1:9150'
    return await Promise.all(allSiteKeys().map((key) => probeSite(key, torAddr, s.tor_proxied_sites)))
  })
  ipcMain.handle(CH.libMirrorsCheck, async () => {
    return await Promise.all(LIB_MIRRORS.map(async (host) => {
      // DNS gate first: a vanished record means a dead mirror server-side.
      try {
        await new Promise<void>((res, rej) => dnsPromiseLookup(host, (e: any) => e ? rej(e) : res()))
      } catch (e: any) {
        return { host, ok: false, ms: -1, error: `DNS записи нет (зеркало удалено) — ${e?.code ?? 'ENOTFOUND'}` }
      }
      const start = Date.now()
      try {
        const r = await httpFetch({ url: `https://${host}/favicon.ico`, timeoutMs: 10000, frontOnEmpty: false })
        // Any HTTP answer (even 404 — many CDNs have no favicon) proves the
        // host is reachable; only network failures make it "bad".
        const reachable = r.status < 500
        return reachable
          ? { host, ok: true, ms: Date.now() - start }
          : { host, ok: false, ms: Date.now() - start, error: `HTTP ${r.status}` }
      } catch (e: any) {
        return { host, ok: false, ms: -1, error: e?.message ?? String(e) }
      }
    }))
  })
  ipcMain.handle(CH.customDnsCheck, async () => {
    return await checkCustomDns('example.com')
  })
  ipcMain.handle(CH.setReadingPosition, (_e, gid: string, index: number) => {
    setReadingPosition(gid, index)
  })
  ipcMain.handle(CH.rescanFolder, (_e, path: string) => {
    const g = galleryFromFolder(path)
    if (!g) return null
    galleries.set(g.id, g)
    return { id: g.id, title: g.title, pageCount: g.pages.length, pages: g.pages, url: `file://${path}` }
  })
  ipcMain.handle(CH.getExAccounts, () => ({ accounts: exAccounts.accounts, currentId: exAccounts.currentId }))
  ipcMain.handle(CH.setExAccount, (_e, id: number) => {
    exAccounts.setCurrent(id)
    return { accounts: exAccounts.accounts, currentId: exAccounts.currentId }
  })
  ipcMain.handle(CH.addExAccount, (_e, name: string, memberId: string, passHash: string, igneous: string) => {
    exAccounts.addManual(name, memberId, passHash, igneous)
    return { accounts: exAccounts.accounts, currentId: exAccounts.currentId }
  })
  ipcMain.handle(CH.removeExAccount, (_e, id: number) => {
    exAccounts.remove(id)
    return { accounts: exAccounts.accounts, currentId: exAccounts.currentId }
  })
  ipcMain.handle(CH.importExAccounts, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Выбери JSON, который сохранил юзерскрипт AutoLogin',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (r.canceled || r.filePaths.length === 0) return null
    let content: string
    try {
      content = readFileSync(r.filePaths[0], 'utf-8')
    } catch (e: any) {
      return { count: 0, accounts: { accounts: exAccounts.accounts, currentId: exAccounts.currentId } }
    }
    const count = exAccounts.importFromContent(content)
    return { count, accounts: { accounts: exAccounts.accounts, currentId: exAccounts.currentId } }
  })
  ipcMain.handle(CH.markChapterRead, (_e, url: string) => {
    const s = settings.get()
    if (!s.read_chapters.includes(url)) {
      settings.save({ ...s, read_chapters: [...s.read_chapters, url] })
    }
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

async function openFolder(path: string): Promise<{ id: string; title: string; pageCount: number; pages: string[]; url: string } | null> {
  if (isZipPath(path)) {
    const zi = await openZipGallery(path, ZIP_TMP)
    if (!zi) return null
    zipMeta.set(zi.id, { zipPath: path, entries: zi.entries })
    const url = `file://${path}`
    history.addOrUpdate({
      url, series_id: url, title: zi.title, cover_url: null,
      source: 'Локальный архив', chapter_label: null, chapter_index: null,
      chapter_total: null, total_pages: zi.pageCount, category: 'main'
    })
    settings.save({ ...settings.get(), viewing_history: history.toVec() })
    return { id: zi.id, title: zi.title, pageCount: zi.pageCount, pages: zi.entries, url }
  }
  const g = galleryFromFolder(path)
  if (!g) return null
  galleries.set(g.id, g)
  const s = settings.get()
  settings.save({ ...s, last_folder: path })
  const url = `file://${path}`
  history.addOrUpdate({
    url, series_id: url, title: g.title, cover_url: null,
    source: 'Локальная папка', chapter_label: null, chapter_index: null,
    chapter_total: null, total_pages: g.pages.length, category: 'main'
  })
  settings.save({ ...settings.get(), viewing_history: history.toVec() })
  return { id: g.id, title: g.title, pageCount: g.pages.length, pages: g.pages, url }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  clearZipTmpAll(ZIP_TMP)
  void shutdownBrowserFetch()
})
