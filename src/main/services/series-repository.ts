import type { LibraryItem, SeriesUpsert, ReadingStatus, LibraryQuery } from '@shared/library'

export interface SeriesRepository {
  all(): LibraryItem[]
  allIncludingDeleted(): LibraryItem[]
  get(key: string): LibraryItem | null
  getIncludingDeleted(key: string): LibraryItem | null
  findByUrl(url: string): LibraryItem | null
  hardDelete(key: string): void
  upsertHistory(item: SeriesUpsert): LibraryItem
  updateProgress(key: string, currentPage: number, totalPages: number, openedAt: number): void
  setStatus(key: string, status: ReadingStatus | null): void
  setFavorite(key: string, at: number | null): void
  setNote(key: string, note: string): void
  setRating(key: string, rating: number | null): void
  setTags(key: string, tags: string[]): void
  delete(key: string): void
  clearHistory(): void
  list(query: LibraryQuery): LibraryItem[]
  countByStatus(): Record<string, number>
  importItems(items: LibraryItem[]): { added: number; updated: number }
}

function clone(i: LibraryItem): LibraryItem {
  return { ...i, tags: [...i.tags] }
}

export abstract class BaseSeriesRepository implements SeriesRepository {
  abstract all(): LibraryItem[]
  abstract allIncludingDeleted(): LibraryItem[]
  abstract get(key: string): LibraryItem | null
  abstract getIncludingDeleted(key: string): LibraryItem | null
  abstract findByUrl(url: string): LibraryItem | null
  abstract hardDelete(key: string): void
  abstract upsertHistory(item: SeriesUpsert): LibraryItem
  abstract updateProgress(key: string, currentPage: number, totalPages: number, openedAt: number): void
  abstract setStatus(key: string, status: ReadingStatus | null): void
  abstract setFavorite(key: string, at: number | null): void
  abstract setNote(key: string, note: string): void
  abstract setRating(key: string, rating: number | null): void
  abstract setTags(key: string, tags: string[]): void
  abstract delete(key: string): void
  abstract clearHistory(): void
  abstract importItems(items: LibraryItem[]): { added: number; updated: number }

  list(query: LibraryQuery): LibraryItem[] {
    let items = this.all()
    items = query.scope === 'favorites'
      ? items.filter((i) => i.favoritedAt !== null)
      : items.filter((i) => i.status !== null)
    if (query.category) items = items.filter((i) => i.category === query.category)
    if (query.includeR34 === false) items = items.filter((i) => i.category !== 'r34')
    if (query.status && query.status !== 'all') items = items.filter((i) => i.status === query.status)
    const q = query.search?.trim().toLowerCase()
    if (q) items = items.filter((i) => i.title.toLowerCase().includes(q))
    const sort = query.sort ?? 'last_read'
    return [...items].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title)
      if (sort === 'rating') return (b.rating ?? 0) - (a.rating ?? 0)
      if (sort === 'added') return b.createdAt - a.createdAt
      return b.openedAt - a.openedAt
    })
  }

  countByStatus(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const i of this.all()) {
      if (!i.status) continue
      out[i.status] = (out[i.status] ?? 0) + 1
    }
    return out
  }
}

export class InMemorySeriesRepository extends BaseSeriesRepository {
  private map = new Map<string, LibraryItem>()

  constructor(seed: LibraryItem[] = []) {
    super()
    for (const i of seed) this.map.set(i.key, clone(i))
  }

  all(): LibraryItem[] {
    return [...this.map.values()].filter((i) => i.deletedAt === null).map(clone)
  }

  allIncludingDeleted(): LibraryItem[] {
    return [...this.map.values()].map(clone)
  }

  get(key: string): LibraryItem | null {
    const v = this.map.get(key)
    return v && v.deletedAt === null ? clone(v) : null
  }

  getIncludingDeleted(key: string): LibraryItem | null {
    const v = this.map.get(key)
    return v ? clone(v) : null
  }

  findByUrl(url: string): LibraryItem | null {
    for (const v of this.map.values()) if (v.url === url && v.deletedAt === null) return clone(v)
    return null
  }

  upsertHistory(item: SeriesUpsert): LibraryItem {
    const now = Date.now()
    const existing = this.map.get(item.key)
    if (existing) {
      const next: LibraryItem = {
        ...existing,
        ...item,
        kind: item.kind ?? existing.kind ?? null,
        coverUrl: item.coverUrl ?? existing.coverUrl,
        currentPage: Math.max(existing.currentPage, item.currentPage),
        totalPages: Math.max(existing.totalPages, item.totalPages),
        openedAt: item.openedAt ?? now,
        createdAt: existing.createdAt,
        updatedAt: now,
        deletedAt: null,
        favoritedAt: existing.favoritedAt
      }
      this.map.set(item.key, next)
      return clone(next)
    }
    const row: LibraryItem = {
      ...item,
      kind: item.kind ?? null,
      status: null, note: '', rating: null, tags: [],
      openedAt: item.openedAt ?? now,
      createdAt: item.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
      favoritedAt: null
    }
    this.map.set(item.key, row)
    return clone(row)
  }

  updateProgress(key: string, currentPage: number, totalPages: number, openedAt: number): void {
    const e = this.map.get(key)
    if (!e) return
    e.currentPage = currentPage
    e.totalPages = Math.max(e.totalPages, totalPages)
    e.openedAt = openedAt
    e.updatedAt = Date.now()
  }

  private patch(key: string, p: Partial<LibraryItem>): void {
    const e = this.map.get(key)
    if (!e) return
    Object.assign(e, p, { updatedAt: Date.now() })
  }

  setStatus(key: string, status: ReadingStatus | null): void { this.patch(key, { status }) }
  setFavorite(key: string, at: number | null): void { this.patch(key, { favoritedAt: at }) }
  setNote(key: string, note: string): void { this.patch(key, { note }) }
  setRating(key: string, rating: number | null): void { this.patch(key, { rating }) }
  setTags(key: string, tags: string[]): void { this.patch(key, { tags: [...tags] }) }

  delete(key: string): void { this.patch(key, { deletedAt: Date.now() }) }

  hardDelete(key: string): void { this.map.delete(key) }

  clearHistory(): void {
    const now = Date.now()
    for (const v of this.map.values()) {
      if (v.status === null && v.deletedAt === null) { v.deletedAt = now; v.updatedAt = now }
    }
  }

  importItems(items: LibraryItem[]): { added: number; updated: number } {
    let added = 0
    let updated = 0
    for (const item of items) {
      const cur = this.map.get(item.key)
      if (!cur) { this.map.set(item.key, clone({ ...item, deletedAt: item.deletedAt ?? null })); added++; continue }
      if (item.updatedAt > cur.updatedAt) { this.map.set(item.key, clone({ ...item, deletedAt: item.deletedAt ?? null })); updated++ }
    }
    return { added, updated }
  }
}
