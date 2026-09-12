import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import { defaultSettings, parseSettings, type Settings } from '@shared/settings'

const LEGACY_DIR = join(process.env.APPDATA ?? '', 'mangareader', 'manga_reader')

export function migrateIfNeeded(userDataDir: string): void {
  const dest = join(userDataDir, 'settings.json')
  if (existsSync(dest)) return
  const legacy = join(LEGACY_DIR, 'settings.json')
  if (!existsSync(legacy)) return
  mkdirSync(userDataDir, { recursive: true })
  copyFileSync(legacy, dest)
}

export class SettingsService {
  readonly path: string
  private current: Settings

  constructor(userDataDir: string) {
    migrateIfNeeded(userDataDir)
    this.path = join(userDataDir, 'settings.json')
    this.current = this.read()
  }

  private read(): Settings {
    if (!existsSync(this.path)) return defaultSettings()
    try {
      return parseSettings(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch {
      return defaultSettings()
    }
  }

  get(): Settings { return this.current }

  save(s: Settings): void {
    this.current = s
    mkdirSync(join(this.path, '..'), { recursive: true })
    writeFileSync(this.path, JSON.stringify(s, null, 2), 'utf8')
  }
}