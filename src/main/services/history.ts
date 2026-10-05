import type { HistoryEntry } from '@shared/types'
import type { LibraryItem, SeriesUpsert } from '@shared/library'
import { mangaSeriesUrlFromChapterUrl } from './sources'
import { InMemorySeriesRepository, type SeriesRepository } from './series-repository'
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

export function normalizeHistory(entries: HistoryEntry[]): SeriesUpsert[] {
  const normalized = entries.map((e) => {
    const seriesId = e.series_id || e.url
    const key = seriesKeyForUrl(e.url) ?? mangaSeriesUrlFromChapterUrl(seriesId) ?? seriesId
    return { e, key }
  })
  normalized.sort((a, b) => b.e.opened_at - a.e.opened_at)
  const byKey = new Map<string, SeriesUpsert>()
  for (const { e, key } of normalized) {
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        key, seriesId: e.series_id || e.url, url: e.url, title: e.title,
        coverUrl: e.cover_url, source: e.source, category: e.category,
        currentPage: e.current_page, totalPages: e.total_pages,
        chapterLabel: e.chapter_label, chapterIndex: e.chapter_index, chapterTotal: e.chapter_total,
        openedAt: e.opened_at, createdAt: e.opened_at
      })
      continue
    }
    existing.currentPage = Math.max(existing.currentPage, e.current_page)
    existing.totalPages = Math.max(existing.totalPages, e.total_pages)
    existing.coverUrl = existing.coverUrl ?? e.cover_url
    existing.chapterLabel = existing.chapterLabel ?? e.chapter_label
    existing.chapterIndex = existing.chapterIndex ?? e.chapter_index
    existing.chapterTotal = existing.chapterTotal ?? e.chapter_total
    existing.openedAt = Math.max(existing.openedAt ?? 0, e.opened_at)
    existing.createdAt = Math.min(existing.createdAt ?? e.opened_at, e.opened_at)
  }
  return [...byKey.values()]
}

function toHistoryEntry(i: LibraryItem): HistoryEntry {
  return {
    url: i.url, series_id: i.seriesId, title: i.title, cover_url: i.coverUrl,
    source: i.source, chapter_label: i.chapterLabel, chapter_index: i.chapterIndex,
    chapter_total: i.chapterTotal, current_page: i.currentPage, total_pages: i.totalPages,
    category: i.category, opened_at: i.openedAt
  }
}

function toUpsert(u: HistoryUpdate, key: string, seriesId: string): SeriesUpsert {
  return {
    key, seriesId: seriesId || u.url, url: u.url, title: u.title, coverUrl: u.cover_url,
    source: u.source, category: u.category, currentPage: 1, totalPages: u.total_pages,
    chapterLabel: u.chapter_label, chapterIndex: u.chapter_index, chapterTotal: u.chapter_total,
    openedAt: Date.now()
  }
}

export class HistoryManager {
  private repo: SeriesRepository
  private entries: HistoryEntry[] = []

  constructor(repo: SeriesRepository = new InMemorySeriesRepository()) {
    this.repo = repo
    this.refresh()
  }

  private refresh(): void {
    this.entries = this.repo.all().map(toHistoryEntry).sort((a, b) => b.opened_at - a.opened_at)
  }

  load(raw: HistoryEntry[]): void {
    if (this.repo.all().length > 0 || raw.length === 0) { this.refresh(); return }
    for (const item of normalizeHistory(raw)) this.repo.upsertHistory(item)
    this.refresh()
  }

  all(): HistoryEntry[] { return this.entries.map((e) => ({ ...e })) }
  mainEntries(): HistoryEntry[] { return this.entries.filter((e) => e.category === 'main') }
  r34Entries(): HistoryEntry[] { return this.entries.filter((e) => e.category === 'r34') }
  toVec(): HistoryEntry[] { return this.all() }

  clear(): void {
    this.repo.clearHistory()
    this.refresh()
  }

  addOrUpdate(update: HistoryUpdate): void {
    const key = seriesKeyForUrl(update.url) ?? update.series_id ?? update.url
    const existing = this.repo.get(key) ?? this.repo.findByUrl(update.url)
    if (existing) {
      if (existing.url !== update.url && update.chapter_index != null && existing.chapterIndex != null && update.chapter_index < existing.chapterIndex) {
        return
      }
      const next = toUpsert(update, existing.key, existing.seriesId)
      if (existing.url === update.url) {
        next.currentPage = Math.max(existing.currentPage, 1)
        next.totalPages = Math.max(existing.totalPages, update.total_pages)
      } else {
        next.coverUrl = update.cover_url ?? existing.coverUrl
        next.currentPage = existing.currentPage
        next.totalPages = Math.max(existing.totalPages, update.total_pages)
      }
      this.repo.upsertHistory(next)
    } else {
      this.repo.upsertHistory(toUpsert(update, key, update.series_id || update.url))
    }
    this.refresh()
  }

  updateProgress(url: string, currentPage: number, totalPages: number): void {
    const key = seriesKeyForUrl(url)
    const item = this.repo.findByUrl(url) ?? (key ? this.repo.get(key) : null)
    if (item) this.repo.updateProgress(item.key, currentPage, totalPages, Date.now())
    this.refresh()
  }
}
