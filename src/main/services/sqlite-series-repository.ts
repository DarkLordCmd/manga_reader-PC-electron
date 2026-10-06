import Database from 'better-sqlite3'
import { BaseSeriesRepository } from './series-repository'
import type { LibraryItem, SeriesUpsert, ReadingStatus } from '@shared/library'

interface SeriesRow {
  key: string; series_id: string; url: string; title: string; cover_url: string | null
  source: string | null; category: string; kind: string | null; current_page: number; total_pages: number
  chapter_label: string | null; chapter_index: number | null; chapter_total: number | null
  status: ReadingStatus | null; note: string; rating: number | null; tags: string
  opened_at: number; created_at: number; updated_at: number; deleted_at: number | null
  favorited_at: number | null
}

function rowToItem(r: SeriesRow): LibraryItem {
  let tags: string[] = []
  try { const p = JSON.parse(r.tags); if (Array.isArray(p)) tags = p.filter((x) => typeof x === 'string') } catch { /* ignore */ }
  return {
    key: r.key, seriesId: r.series_id, url: r.url, title: r.title, coverUrl: r.cover_url,
    source: r.source ?? '', category: r.category, kind: r.kind, currentPage: r.current_page, totalPages: r.total_pages,
    chapterLabel: r.chapter_label, chapterIndex: r.chapter_index, chapterTotal: r.chapter_total,
    status: r.status, note: r.note, rating: r.rating, tags,
    openedAt: r.opened_at, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
    favoritedAt: r.favorited_at
  }
}

export class SqliteSeriesRepository extends BaseSeriesRepository {
  constructor(private db: Database.Database) { super() }

  all(): LibraryItem[] {
    return (this.db.prepare('SELECT * FROM series WHERE deleted_at IS NULL').all() as SeriesRow[]).map(rowToItem)
  }

  allIncludingDeleted(): LibraryItem[] {
    return (this.db.prepare('SELECT * FROM series').all() as SeriesRow[]).map(rowToItem)
  }

  get(key: string): LibraryItem | null {
    const r = this.db.prepare('SELECT * FROM series WHERE key = ? AND deleted_at IS NULL').get(key) as SeriesRow | undefined
    return r ? rowToItem(r) : null
  }

  getIncludingDeleted(key: string): LibraryItem | null {
    const r = this.db.prepare('SELECT * FROM series WHERE key = ?').get(key) as SeriesRow | undefined
    return r ? rowToItem(r) : null
  }

  findByUrl(url: string): LibraryItem | null {
    const r = this.db.prepare('SELECT * FROM series WHERE url = ? AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1').get(url) as SeriesRow | undefined
    return r ? rowToItem(r) : null
  }

  upsertHistory(item: SeriesUpsert): LibraryItem {
    const now = Date.now()
    const existing = this.getIncludingDeleted(item.key)
    if (existing) {
      this.db.prepare(`
        UPDATE series SET series_id = @series_id, url = @url, title = @title,
          cover_url = @cover_url, source = @source, category = @category, kind = @kind,
          current_page = @current_page, total_pages = @total_pages,
          chapter_label = @chapter_label, chapter_index = @chapter_index, chapter_total = @chapter_total,
          opened_at = @opened_at, updated_at = @updated_at, deleted_at = NULL
        WHERE key = @key
      `).run({
        key: item.key, series_id: item.seriesId, url: item.url, title: item.title,
        cover_url: item.coverUrl ?? existing.coverUrl, source: item.source, category: item.category,
        kind: item.kind ?? existing.kind ?? null,
        current_page: Math.max(existing.currentPage, item.currentPage),
        total_pages: Math.max(existing.totalPages, item.totalPages),
        chapter_label: item.chapterLabel, chapter_index: item.chapterIndex, chapter_total: item.chapterTotal,
        opened_at: item.openedAt ?? now, updated_at: now
      })
    } else {
      this.db.prepare(`
        INSERT INTO series (key, series_id, url, title, cover_url, source, category, kind,
          current_page, total_pages, chapter_label, chapter_index, chapter_total,
          status, note, rating, tags, opened_at, created_at, updated_at, deleted_at, favorited_at)
        VALUES (@key, @series_id, @url, @title, @cover_url, @source, @category, @kind,
          @current_page, @total_pages, @chapter_label, @chapter_index, @chapter_total,
          NULL, '', NULL, '[]', @opened_at, @created_at, @updated_at, NULL, NULL)
      `).run({
        key: item.key, series_id: item.seriesId, url: item.url, title: item.title,
        cover_url: item.coverUrl, source: item.source, category: item.category, kind: item.kind ?? null,
        current_page: item.currentPage, total_pages: item.totalPages,
        chapter_label: item.chapterLabel, chapter_index: item.chapterIndex, chapter_total: item.chapterTotal,
        opened_at: item.openedAt ?? now, created_at: item.createdAt ?? now, updated_at: now
      })
    }
    return this.get(item.key)!
  }

  updateProgress(key: string, currentPage: number, totalPages: number, openedAt: number): void {
    this.db.prepare(`
      UPDATE series SET current_page = ?, total_pages = MAX(total_pages, ?), opened_at = ?, updated_at = ?
      WHERE key = ?
    `).run(currentPage, totalPages, openedAt, Date.now(), key)
  }

  private patch(key: string, col: string, value: unknown): void {
    this.db.prepare(`UPDATE series SET ${col} = ?, updated_at = ? WHERE key = ?`).run(value, Date.now(), key)
  }

  setStatus(key: string, status: ReadingStatus | null): void { this.patch(key, 'status', status) }
  setFavorite(key: string, at: number | null): void {
    this.db.prepare('UPDATE series SET favorited_at = ?, updated_at = ? WHERE key = ?').run(at, Date.now(), key)
  }
  setNote(key: string, note: string): void { this.patch(key, 'note', note) }
  setRating(key: string, rating: number | null): void { this.patch(key, 'rating', rating) }
  setTags(key: string, tags: string[]): void { this.patch(key, 'tags', JSON.stringify(tags)) }

  delete(key: string): void {
    const now = Date.now()
    this.db.prepare('UPDATE series SET deleted_at = ?, updated_at = ? WHERE key = ?').run(now, now, key)
  }

  hardDelete(key: string): void { this.db.prepare('DELETE FROM series WHERE key = ?').run(key) }

  clearHistory(): void {
    const now = Date.now()
    this.db.prepare('UPDATE series SET deleted_at = ?, updated_at = ? WHERE status IS NULL AND deleted_at IS NULL').run(now, now)
  }

  importItems(items: LibraryItem[]): { added: number; updated: number } {
    let added = 0
    let updated = 0
    const tx = this.db.transaction((rows: LibraryItem[]) => {
      for (const i of rows) {
        const cur = this.getIncludingDeleted(i.key)
        if (!cur) {
          this.db.prepare(`
            INSERT INTO series (key, series_id, url, title, cover_url, source, category, kind,
              current_page, total_pages, chapter_label, chapter_index, chapter_total,
              status, note, rating, tags, opened_at, created_at, updated_at, deleted_at, favorited_at)
            VALUES (@key, @series_id, @url, @title, @cover_url, @source, @category, @kind,
              @current_page, @total_pages, @chapter_label, @chapter_index, @chapter_total,
              @status, @note, @rating, @tags, @opened_at, @created_at, @updated_at, @deleted_at, @favorited_at)
          `).run({
            key: i.key, series_id: i.seriesId, url: i.url, title: i.title, cover_url: i.coverUrl,
            source: i.source, category: i.category, kind: i.kind ?? null, current_page: i.currentPage, total_pages: i.totalPages,
            chapter_label: i.chapterLabel, chapter_index: i.chapterIndex, chapter_total: i.chapterTotal,
            status: i.status, note: i.note, rating: i.rating, tags: JSON.stringify(i.tags),
            opened_at: i.openedAt, created_at: i.createdAt, updated_at: i.updatedAt,
            deleted_at: i.deletedAt ?? null, favorited_at: i.favoritedAt ?? null
          })
          added++
        } else if (i.updatedAt > cur.updatedAt) {
          this.db.prepare(`
            UPDATE series SET series_id=@series_id, url=@url, title=@title, cover_url=@cover_url,
              source=@source, category=@category, kind=@kind, current_page=@current_page, total_pages=@total_pages,
              chapter_label=@chapter_label, chapter_index=@chapter_index, chapter_total=@chapter_total,
              status=@status, note=@note, rating=@rating, tags=@tags,
              opened_at=@opened_at, created_at=@created_at, updated_at=@updated_at, deleted_at=@deleted_at,
              favorited_at=@favorited_at
            WHERE key=@key
          `).run({
            key: i.key, series_id: i.seriesId, url: i.url, title: i.title, cover_url: i.coverUrl,
            source: i.source, category: i.category, kind: i.kind ?? null, current_page: i.currentPage, total_pages: i.totalPages,
            chapter_label: i.chapterLabel, chapter_index: i.chapterIndex, chapter_total: i.chapterTotal,
            status: i.status, note: i.note, rating: i.rating, tags: JSON.stringify(i.tags),
            opened_at: i.openedAt, created_at: i.createdAt, updated_at: i.updatedAt,
            deleted_at: i.deletedAt ?? null, favorited_at: i.favoritedAt ?? null
          })
          updated++
        }
      }
    })
    tx(items)
    return { added, updated }
  }
}
