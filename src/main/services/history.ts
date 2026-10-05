import type { HistoryEntry } from '@shared/types'
import { mangaSeriesUrlFromChapterUrl } from './sources'
import { galleryKeyForUrl, seriesKeyForUrl, sourceLabelForUrl } from './series-key'
export { galleryKeyForUrl, seriesKeyForUrl, sourceLabelForUrl } from './series-key'

export interface HistoryUpdate {
  url: string
  series_id: string
  title: string
  cover_url: string | null
  source: string
  chapter_label: string | null
  chapter_index: number | null
  chapter_total: number | null
  total_pages: number
  category: string
}

function matchesEntry(entry: HistoryEntry, key: string | null, seriesId: string, url: string): boolean {
  if (key && seriesKeyForUrl(entry.url) === key) return true
  return entry.series_id === seriesId || entry.url === url
}

export class HistoryManager {
  entries: HistoryEntry[] = []

  load(entries: HistoryEntry[]): void {
    const normalized = entries.map((e) => {
      const seriesId = e.series_id || e.url
      const normalizedSeries = seriesKeyForUrl(e.url) ?? mangaSeriesUrlFromChapterUrl(seriesId) ?? seriesId
      return { ...e, series_id: normalizedSeries }
    })
    normalized.sort((a, b) => b.opened_at - a.opened_at)
    // One entry per gallery: clearnet and onion records of the same gallery
    // collapse, keeping the newest url, best cover and the largest progress.
    const byKey = new Map<string, HistoryEntry>()
    for (const e of normalized) {
      const key = e.series_id
      const cur = byKey.get(key)
      if (!cur) { byKey.set(key, e); continue }
      cur.current_page = Math.max(cur.current_page, e.current_page)
      cur.total_pages = Math.max(cur.total_pages, e.total_pages)
      cur.cover_url = cur.cover_url ?? e.cover_url
      cur.chapter_label = cur.chapter_label ?? e.chapter_label
      cur.chapter_index = cur.chapter_index ?? e.chapter_index
      cur.chapter_total = cur.chapter_total ?? e.chapter_total
    }
    this.entries = [...byKey.values()]
  }

  all(): HistoryEntry[] { return this.entries }
  mainEntries(): HistoryEntry[] { return this.entries.filter((e) => e.category === 'main') }
  r34Entries(): HistoryEntry[] { return this.entries.filter((e) => e.category === 'r34') }
  toVec(): HistoryEntry[] { return this.entries.map((e) => ({ ...e })) }

  clear(): void { this.entries = [] }

  addOrUpdate(update: HistoryUpdate): void {
    const seriesKey = seriesKeyForUrl(update.url)
    const seriesId = update.series_id || update.url
    const existing = this.entries.find((e) => matchesEntry(e, seriesKey, seriesId, update.url))
    if (existing) {
      if (existing.url === update.url) {
        const current_page = Math.max(existing.current_page, 1)
        const cover_url = update.cover_url ?? existing.cover_url
        this.entries = this.entries.filter((e) => e !== existing)
        this.entries.unshift(this.newEntry({ ...update, cover_url }, current_page))
        return
      }
      if (update.chapter_index != null && existing.chapter_index != null && update.chapter_index < existing.chapter_index) {
        return
      }
      update = { ...update, cover_url: update.cover_url ?? existing.cover_url }
    }
    this.entries = this.entries.filter((e) => !matchesEntry(e, seriesKey, seriesId, update.url))
    this.entries.unshift(this.newEntry(update, 1))
  }

  updateProgress(url: string, currentPage: number, totalPages: number): void {
    const seriesKey = seriesKeyForUrl(url)
    const e = this.entries.find((x) => x.url === url)
      ?? this.entries.find((x) => seriesKey && seriesKeyForUrl(x.url) === seriesKey)
    if (e) {
      e.current_page = currentPage
      e.total_pages = Math.max(e.total_pages, totalPages)
      e.opened_at = Date.now()
    }
  }

  private newEntry(u: HistoryUpdate, current_page: number): HistoryEntry {
    return {
      url: u.url, series_id: u.series_id, title: u.title, cover_url: u.cover_url,
      source: u.source, chapter_label: u.chapter_label, chapter_index: u.chapter_index,
      chapter_total: u.chapter_total, current_page, total_pages: u.total_pages,
      category: u.category, opened_at: Date.now()
    }
  }
}