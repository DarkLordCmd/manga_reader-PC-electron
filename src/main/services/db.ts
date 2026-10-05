import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, renameSync } from 'fs'
import { SqliteSeriesRepository } from './sqlite-series-repository'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS series (
  key TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  cover_url TEXT,
  source TEXT,
  category TEXT NOT NULL DEFAULT 'main',
  current_page INTEGER NOT NULL DEFAULT 1,
  total_pages INTEGER NOT NULL DEFAULT 0,
  chapter_label TEXT,
  chapter_index INTEGER,
  chapter_total INTEGER,
  status TEXT,
  note TEXT NOT NULL DEFAULT '',
  rating INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
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

function openAt(path: string): Database.Database {
  const db = new Database(path)
  try {
    db.pragma('journal_mode = WAL')
    db.exec(SCHEMA)
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
