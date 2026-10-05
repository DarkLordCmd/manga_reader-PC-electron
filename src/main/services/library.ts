import type { LibraryItem, SeriesUpsert, ReadingStatus, LibraryQuery } from '@shared/library'
import type { SeriesRepository } from './series-repository'
import { seriesKeyForUrl } from './series-key'

export interface CatalogAddEntry {
  url: string
  title: string
  coverUrl: string | null
  source: string
  seriesId: string
  category?: string
}

export class LibraryService {
  constructor(
    private repo: SeriesRepository,
    private opts: { autoAdd: () => boolean }
  ) {}

  autoAddIfNeeded(url: string, seriesId: string): void {
    if (!this.opts.autoAdd() || url.startsWith('file:')) return
    const key = seriesKeyForUrl(url) ?? seriesId ?? url
    const item = this.repo.get(key) ?? this.repo.findByUrl(url)
    if (item && item.status === null) this.repo.setStatus(item.key, 'reading')
  }

  addFromCatalog(entry: CatalogAddEntry): LibraryItem {
    const key = seriesKeyForUrl(entry.url) ?? entry.seriesId ?? entry.url
    const upsert: SeriesUpsert = {
      key, seriesId: entry.seriesId, url: entry.url, title: entry.title,
      coverUrl: entry.coverUrl, source: entry.source, category: entry.category ?? 'main',
      currentPage: 1, totalPages: 0, chapterLabel: null, chapterIndex: null, chapterTotal: null
    }
    const item = this.repo.upsertHistory(upsert)
    if (item.status === null) this.repo.setStatus(item.key, 'planned')
    return this.repo.get(item.key)!
  }

  get(key: string): LibraryItem | null { return this.repo.get(key) }
  list(query: LibraryQuery): LibraryItem[] { return this.repo.list(query) }
  countByStatus(): Record<string, number> { return this.repo.countByStatus() }
  setStatus(key: string, status: ReadingStatus | null): void { this.repo.setStatus(key, status) }
  setNote(key: string, note: string): void { this.repo.setNote(key, note) }
  setRating(key: string, rating: number | null): void { this.repo.setRating(key, rating) }
  setTags(key: string, tags: string[]): void { this.repo.setTags(key, tags) }
  removeFromLibrary(key: string): void { this.repo.setStatus(key, null) }
  deleteSeries(key: string): void { this.repo.delete(key) }
}
