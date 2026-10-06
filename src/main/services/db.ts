import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, renameSync } from 'fs'
import { SqliteSeriesRepository } from './sqlite-series-repository'
import { needsDeletedAtColumn, needsFavoritedAtColumn, needsKindColumn } from './db-migrate'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS series (
  key TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  cover_url TEXT,
  source TEXT,
  category TEXT NOT NULL DEFAULT 'main',
  kind TEXT,
  current_page INTEGER NOT NULL DEFAULT 1,
  total_pages INTEGER NOT NULL DEFAULT 0,
  chapter_label TEXT,
  chapter_index INTEGER,
  chapter_total INTEGER,
  status TEXT,
  note TEXT NOT NULL DEFAULT '',
  rating INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  deleted_at INTEGER,
  favorited_at INTEGER,
  opened_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_series_status ON series(status);
CREATE INDEX IF NOT EXISTS idx_series_opened ON series(opened_at);
CREATE INDEX IF NOT EXISTS idx_series_title ON series(title);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`

export interface DbHandle {
  db: Database.Database
  repo: SqliteSeriesRepository
}

function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  const cols = (db.pragma('table_info(series)') as { name: string }[]).map((c) => c.name)
  if (needsDeletedAtColumn(version, cols)) {
    db.exec('ALTER TABLE series ADD COLUMN deleted_at INTEGER')
  }
  if (needsFavoritedAtColumn(version, cols)) {
    db.exec('ALTER TABLE series ADD COLUMN favorited_at INTEGER')
  }
  if (needsKindColumn(version, cols)) {
    db.exec('ALTER TABLE series ADD COLUMN kind TEXT')
  }
  if (version < 4) {
    // Backfill: rows added to the library/favorites from the catalog used to
    // default to category 'main' even for R34 sources (E-Hentai family /
    // nhentai). Reclassify them so they show under the R34 tab.
    db.exec(
      "UPDATE series SET category = 'r34' WHERE category = 'main' " +
      "AND (url LIKE '%exhentai%' OR url LIKE '%e-hentai.org%' OR url LIKE '%nhentai%')"
    )
  }
  db.pragma('user_version = 5')
}

function openAt(path: string): Database.Database {
  const db = new Database(path)
  try {
    db.pragma('journal_mode = WAL')
    db.exec(SCHEMA)
    migrate(db)
    return db
  } catch (e) {
    try { db.close() } catch { /* ignore */ }
    throw e
  }
}

export function openDatabase(userDataDir: string): DbHandle {
  const path = join(userDataDir, 'library.db')
  let db: Database.Database
  try {
    db = openAt(path)
  } catch {
    const ts = Date.now()
    for (const f of [path, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(f)) {
        try { renameSync(f, `${f}.corrupt-${ts}`) } catch { /* ignore */ }
      }
    }
    db = openAt(path)
  }
  return { db, repo: new SqliteSeriesRepository(db) }
}
