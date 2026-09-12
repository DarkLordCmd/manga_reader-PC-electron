import type { HistoryEntry } from '@shared/types'
import { mangaSeriesUrlFromChapterUrl } from './sources'

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

export function sourceLabelForUrl(url: string): string {
  const lower = url.toLowerCase()
  if (lower.startsWith('file://')) return 'Локальная папка'
  if (lower.includes('mangadex') || (!lower.startsWith('http') && url.length === 36)) return 'MangaDex'
  if (lower.includes('exhentai')) return 'ExHentai'
  if (lower.includes('e-hentai.org')) return 'E-Hentai'
  if (lower.includes('nhentai')) return 'NHentai'
  if (lower.includes('com-x.life')) return 'Com-X'
  if (lower.includes('senkuro.')) return 'Senkuro'
  if (lower.includes('manga-shi.')) return 'Manga-shi'
  if (lower.includes('remanga.')) return 'Remanga'
  if (lower.includes('mangalib.')) return 'Mangalib'
  return ''
}

export class HistoryManager {
  entries: HistoryEntry[] = []

  load(entries: HistoryEntry[]): void {
    const normalized = entries.map((e) => {
      const seriesId = e.series_id || e.url
      const normalizedSeries = mangaSeriesUrlFromChapterUrl(seriesId)
      return { ...e, series_id: normalizedSeries ?? seriesId }
    })
    normalized.sort((a, b) => b.opened_at - a.opened_at)
    const seen = new Set<string>()
    this.entries = normalized.filter((e) => (seen.has(e.series_id) ? false : (seen.add(e.series_id), true)))
  }

  all(): HistoryEntry[] { return this.entries }
  mainEntries(): HistoryEntry[] { return this.entries.filter((e) => e.category === 'main') }
  r34Entries(): HistoryEntry[] { return this.entries.filter((e) => e.category === 'r34') }
  toVec(): HistoryEntry[] { return this.entries.map((e) => ({ ...e })) }

  clear(): void { this.entries = [] }

  addOrUpdate(update: HistoryUpdate): void {
    const existing = this.entries.find((e) => e.series_id === update.series_id)
    if (existing) {
      if (existing.url === update.url) {
        const current_page = Math.max(existing.current_page, 1)
        const cover_url = update.cover_url ?? existing.cover_url
        this.entries = this.entries.filter((e) => e.series_id !== update.series_id)
        this.entries.unshift(this.newEntry({ ...update, cover_url }, current_page))
        return
      }
      if (update.chapter_index != null && existing.chapter_index != null && update.chapter_index < existing.chapter_index) {
        return
      }
      update = { ...update, cover_url: update.cover_url ?? existing.cover_url }
    }
    this.entries = this.entries.filter((e) => e.series_id !== update.series_id)
    this.entries.unshift(this.newEntry(update, 1))
  }

  updateProgress(url: string, currentPage: number, totalPages: number): void {
    const e = this.entries.find((x) => x.url === url)
    if (e) { e.current_page = currentPage; e.total_pages = totalPages; e.opened_at = Date.now() }
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