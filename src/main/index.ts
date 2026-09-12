import { app, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { readFileSync } from 'fs'
import { SettingsService } from './services/settings'
import { HistoryManager } from './services/history'
import { galleryFromFolder, type Gallery } from './services/gallery'
import { resolveAtHome, fetchChapterList, searchMangaDex } from './services/mangadex'
import { createOnlineGallery, requestPage, setReadingPosition, getGalleryPages } from './services/online-gallery'
import { fetchSimpleGallery } from './services/simple-gallery'
import {
  fetchRemangaChapter, fetchRemangaChapters, fetchSenkuroChapter, fetchSenkuroChapters,
  mangaSeriesUrlFromChapterUrl
} from './services/sources'
import { fetchMangaShiChapters } from './services/catalog-search'
import { searchExHentai, searchMangaShi, searchNhentai, searchRemanga, searchSenkuro, searchSimpleSite } from './services/catalog-search'
import { runLoginWindow } from './services/login'
import { probeSocks5Handshake, probeBridgeLine, probeSite, allSiteKeys } from './services/tor-check'
import { fetchEhTagSuggest, fetchNhentaiTagSuggestions } from './services/tags'
import { fetchCoverBuffer } from './services/covers'
import { ExAccountsService } from './services/accounts'
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
let exAccounts: ExAccountsService

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

function isUuid(s: string): boolean {
  return s.length === 36 && [...s].every((c, i) =>
    (i === 8 || i === 13 || i === 18 || i === 23) ? c === '-' : /[0-9a-fA-F]/.test(c))
}

function sourceLabel(url: string): string {
  const l = url.toLowerCase()
  if (l.includes('mangadex')) return 'MangaDex'
  if (l.includes('exhentai')) return 'ExHentai'
  if (l.includes('e-hentai.org')) return 'E-Hentai'
  if (l.includes('nhentai')) return 'NHentai'
  if (l.includes('com-x.life')) return 'Com-X'
  if (l.includes('senkuro')) return 'Senkuro'
  if (l.includes('manga-shi')) return 'Manga-shi'
  if (l.includes('remanga')) return 'Remanga'
  if (l.includes('mangalib')) return 'Mangalib'
  return ''
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

app.whenReady().then(() => {
  settings = new SettingsService(app.getPath('userData'))
  exAccounts = new ExAccountsService(app.getPath('userData'))
  exAccounts.init()
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
        const buf = await getCover(target)
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
  ipcMain.handle(CH.openUrl, async (_e, url: string, startPage?: number, mangaId?: string | null) => {
    const trimmed = url.trim()
    const s = settings.get()
    const torSocks = s.tor_socks_addr || '127.0.0.1:9150'
    const useTor = url.includes('.onion')
      || (url.includes('nhentai') && s.tor_proxied_sites.includes('nhentai'))
      || (url.includes('e-hentai.org') && s.tor_proxied_sites.includes('ehentai'))
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
    let result: { title: string; pageUrls: string[]; coverUrl: string | null; source: string; referer: string | null; proxy?: string; mangaId: string | null }
    let seriesId = mangaId ?? trimmed
    const seriesUrl = mangaSeriesUrlFromChapterUrl(trimmed)
    if (seriesUrl) seriesId = seriesUrl

    const chapterId = extractMangaDexChapterId(trimmed)
    if (chapterId) {
      const atHome = await resolveAtHome(chapterId)
      const pageUrls = atHome.files.map((f) => `${atHome.baseUrl}/data/${atHome.hash}/${f}`)
      result = { title: `MangaDex Chapter ${chapterId}`, pageUrls, coverUrl: null, source: 'MangaDex', referer: 'https://mangadex.org/', mangaId: seriesId }
    } else if (trimmed.includes('remanga.org/manga/')) {
      const r = await fetchRemangaChapter(trimmed)
      result = { title: r.title, pageUrls: r.pageUrls, coverUrl: null, source: 'Remanga', referer: 'https://remanga.org/', mangaId: seriesId }
    } else if (trimmed.includes('senkuro') && trimmed.includes('/chapter/')) {
      const r = await fetchSenkuroChapter(trimmed)
      result = { title: r.title, pageUrls: r.pageUrls, coverUrl: null, source: 'Senkuro', referer: `${r.base}/`, mangaId: seriesId }
    } else if (trimmed.includes('manga-shi.') || trimmed.includes('nhentai') || trimmed.includes('com-x.life') || trimmed.includes('mangalib.') || trimmed.includes('e-hentai.org') || trimmed.includes('exhentai')) {
      const g = await fetchSimpleGallery(trimmed, { proxy, cookieHeader })
      result = { title: g.title, pageUrls: g.pageUrls, coverUrl: g.coverUrl, source: sourceLabel(trimmed), referer: trimmed, proxy, mangaId: seriesId }
    } else {
      return null
    }

    const gid = createOnlineGallery(result.title, result.pageUrls, result.proxy)
    const headers: Record<string, string> = {}
    if (result.referer) headers.Referer = result.referer
    if (cookieHeader && (trimmed.includes('.onion') || trimmed.includes('exhentai') || trimmed.includes('e-hentai.org'))) headers.Cookie = cookieHeader
    onlineHeaders.set(gid, headers)

    history.addOrUpdate({
      url: trimmed, series_id: seriesId, title: result.title,
      cover_url: result.coverUrl, source: result.source, chapter_label: null,
      chapter_index: null, chapter_total: null, total_pages: result.pageUrls.length,
      category: trimmed.includes('nhentai') || trimmed.includes('exhentai') || trimmed.includes('e-hentai.org') ? 'r34' : 'main'
    })
    settings.save({ ...settings.get(), viewing_history: history.toVec() })
    if (startPage && startPage > 0 && startPage < result.pageUrls.length) setReadingPosition(gid, startPage)
    return { id: gid, title: result.title, pageCount: result.pageUrls.length, source: result.source, url: trimmed, mangaId: seriesId }
  })
  ipcMain.handle(CH.fetchChapterList, async (_e, mangaId: string) => {
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
    } else {
      chapters = await fetchChapterList(mangaId)
    }
    return chapters.map((c) => ({ chapter_id: c.chapter_id, chapter_num: c.chapter_num, title: c.title }))
  })
  ipcMain.handle(CH.searchCatalog, async (_e, source: string, query: string, page: number, sort: string, filters: any = {}) => {
    const s = settings.get()
    const torSocks = s.tor_socks_addr || '127.0.0.1:9150'
    const siteKey = source === 'nhentai_onion' ? 'nhentai' : source
    const proxy = s.tor_proxied_sites.includes(siteKey) || source.endsWith('_onion') ? torSocks : undefined

    if (source === 'mangadex') {
      return (await searchMangaDex(query, sort as any, page, filters.mangadexTags ?? [], filters.mangadexLangs ?? [])).map((c) => ({
        url: c.manga_id, title: c.title, coverUrl: c.cover_url, pages: null, kind: c.kind, score: c.score
      }))
    }
    if (source === 'remanga') return await searchRemanga(query, page, filters)
    if (source === 'senkuro') return await searchSenkuro(query, s.onion_cookies_raw)
    if (source === 'mangashi') return await searchMangaShi(query, proxy, filters)
    if (source === 'nhentai') return await searchNhentai('https://nhentai.net', query, page, { proxy, cookieHeader: s.onion_cookies_raw, showPageCounts: s.nhentai_show_page_counts, tags: filters.nhentaiTags })
    if (source === 'nhentai_onion') {
      const base = s.nhentai_onion_base || 'http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion'
      return await searchNhentai(base, query, page, { proxy: torSocks, cookieHeader: s.nhentai_onion_cookies_raw, showPageCounts: s.nhentai_show_page_counts, tags: filters.nhentaiTags })
    }
    if (source === 'ehentai' || source === 'exhentai' || source === 'exhentai_onion') {
      const useOnion = source === 'exhentai_onion'
      const cookieHeader = useOnion ? s.onion_cookies_raw : exAccounts.currentCookieHeader()
      const exProxy = useOnion
        ? torSocks
        : (s.exhentai_proxy_addr.trim() || undefined)
      const ex = await searchExHentai(query, {
        cookieHeader,
        torSocksAddr: torSocks,
        useOnion,
        page,
        forceTor: source === 'ehentai' && s.tor_proxied_sites.includes('ehentai'),
        excludedCats: filters.ehExcludedCats
      }, exProxy)
      return ex.map((c) => ({ url: c.url, title: c.title, coverUrl: c.coverUrl, pages: c.pages, score: c.rating }))
    }
    if (source === 'comx' || source === 'mangalib') {
      const cfg = {
        comx: { name: 'Com-X', base: 'https://com-x.life', catalogPath: '/manga/', searchPath: '/search?q=', linkMarker: '/manga/' },
        mangalib: { name: 'Mangalib', base: 'https://mangalib.me', catalogPath: '/manga-list', searchPath: '/search?q=', linkMarker: '/manga/' }
      }[source]!
      return await searchSimpleSite(cfg, query, '', { proxy })
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

function openFolder(path: string): { id: string; title: string; pageCount: number; pages: string[]; url: string } | null {
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
