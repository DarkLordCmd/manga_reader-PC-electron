import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import { defaultSettings, parseSettings, type Settings } from '@shared/settings'
import { isEncrypted, encryptSecret, decryptSecret } from './secret-box'

const SECRET_FIELDS = ['onion_cookies_raw', 'nhentai_cookies_raw', 'senkuro_cookies_raw', 'nhentai_onion_cookies_raw'] as const

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
  private needsSecretRewrite = false

  constructor(userDataDir: string) {
    migrateIfNeeded(userDataDir)
    this.path = join(userDataDir, 'settings.json')
    this.current = this.read()
    if (this.needsSecretRewrite) this.save(this.current)
  }

  private read(): Settings {
    if (!existsSync(this.path)) return defaultSettings()
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, unknown>
      this.needsSecretRewrite = SECRET_FIELDS.some((k) => {
        const v = raw[k]
        return typeof v === 'string' && v !== '' && !isEncrypted(v)
      })
      for (const k of SECRET_FIELDS) {
        if (typeof raw[k] === 'string') raw[k] = decryptSecret(raw[k] as string)
      }
      const s = parseSettings(raw)
      return s
    } catch {
      return defaultSettings()
    }
  }

  get(): Settings { return this.current }

  save(s: Settings): void {
    this.current = s
    const out = { ...s } as Record<string, unknown>
    for (const k of SECRET_FIELDS) {
      const v = (s as unknown as Record<string, string>)[k] ?? ''
      const enc = encryptSecret(v)
      out[k] = enc !== null ? enc : v
    }
    mkdirSync(join(this.path, '..'), { recursive: true })
    writeFileSync(this.path, JSON.stringify(out, null, 2), 'utf8')
  }
}