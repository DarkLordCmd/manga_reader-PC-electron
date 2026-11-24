import { existsSync, mkdirSync, readFileSync, copyFileSync, renameSync } from 'fs';
import { join } from 'path';
import { defaultSettings, parseSettings, type Settings } from '@shared/settings';
import { isEncrypted, encryptSecret, decryptSecret } from './secret-box';
import { writeFileAtomic } from './atomic-write';
import { logger } from './logger';

const SECRET_FIELDS = [
  'onion_cookies_raw',
  'nhentai_cookies_raw',
  'senkuro_cookies_raw',
  'nhentai_onion_cookies_raw',
  'mangashi_cookies_raw',
  'mangalib_cookies_raw',
  'comx_cookies_raw',
  'remanga_token',
  'remanga_cookies_raw',
] as const;

const LEGACY_DIR = join(process.env.APPDATA ?? '', 'mangareader', 'manga_reader');

export function migrateIfNeeded(userDataDir: string): void {
  const dest = join(userDataDir, 'settings.json');
  if (existsSync(dest)) return;
  const legacy = join(LEGACY_DIR, 'settings.json');
  if (!existsSync(legacy)) return;
  mkdirSync(userDataDir, { recursive: true });
  copyFileSync(legacy, dest);
}

export class SettingsService {
  readonly path: string;
  private current: Settings;
  private needsSecretRewrite = false;

  constructor(userDataDir: string) {
    migrateIfNeeded(userDataDir);
    this.path = join(userDataDir, 'settings.json');
    this.current = this.read();
    if (this.needsSecretRewrite) this.save(this.current);
  }

  private read(): Settings {
    if (!existsSync(this.path)) return defaultSettings();
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch {
      // Unreadable (locked / permission) is not corruption: keep whatever is
      // on disk untouched and run on defaults for this session.
      return defaultSettings();
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Never overwrite a half-written settings.json: move it aside so the
      // user can recover it, and let the next save write a clean file.
      const aside = `${this.path}.bad-${Date.now()}`;
      try {
        renameSync(this.path, aside);
        logger.error('[settings] settings.json повреждён — сохранён как', aside);
      } catch {
        logger.error('[settings] settings.json повреждён и не может быть переименован');
      }
      return defaultSettings();
    }
    this.needsSecretRewrite = SECRET_FIELDS.some((k) => {
      const v = raw[k];
      return typeof v === 'string' && v !== '' && !isEncrypted(v);
    });
    for (const k of SECRET_FIELDS) {
      if (typeof raw[k] === 'string') raw[k] = decryptSecret(raw[k] as string);
    }
    return parseSettings(raw);
  }

  get(): Settings {
    return this.current;
  }

  save(s: Settings): void {
    this.current = s;
    const out = { ...s } as Record<string, unknown>;
    for (const k of SECRET_FIELDS) {
      const v = (s as unknown as Record<string, string>)[k] ?? '';
      const enc = encryptSecret(v);
      out[k] = enc !== null ? enc : v;
    }
    // Atomic: settings.json is rewritten on every progress tick, so a crash
    // mid-write must not be able to truncate it into "everything is default".
    // Compact JSON (no indentation): pretty-printing inflated every 5-second
    // rewrite by ~70% for a file nobody edits by hand.
    writeFileAtomic(this.path, JSON.stringify(out), { mode: 0o600 });
  }
}
