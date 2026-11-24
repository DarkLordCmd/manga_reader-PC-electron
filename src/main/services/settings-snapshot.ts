import type { Settings } from '@shared/settings';
import { SECRET_SETTINGS } from './backup';

/** Cookie values ever handed to the renderer.
 *
 * The renderer sends its whole settings object back on every UI change
 * (reader mode, quick searches, tag bookmarks…). Its copy can be stale: a
 * login window may have saved a fresh session into the main process after the
 * renderer loaded its snapshot. Without this guard the stale cookie string
 * was written back and the next launch required another login.
 *
 * A history (not just the latest value) is kept because the echo can arrive
 * after a newer broadcast: the renderer's message with value B must not
 * overwrite the fresh value C stored in the main process. */
const sentSecrets = new Map<string, Set<string>>();
const HISTORY_LIMIT = 20;

/** Remanga credentials are owned by login/logout IPC, never by the renderer.
 * Keep the account metadata visible but omit both session secrets. */
export function settingsForRenderer(s: Settings): Settings {
  return { ...s, remanga_token: '', remanga_cookies_raw: '' };
}

export function rememberSettingsSecrets(s: Settings): void {
  for (const k of SECRET_SETTINGS) {
    const value = String((s as unknown as Record<string, unknown>)[k] ?? '');
    let seen = sentSecrets.get(k);
    if (!seen) {
      seen = new Set();
      sentSecrets.set(k, seen);
    }
    seen.add(value);
    if (seen.size > HISTORY_LIMIT) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  }
}

/** True when `value` is a cookie string we previously sent to the renderer —
 * i.e. an echo of a stale snapshot rather than a deliberate edit. */
export function isRendererSnapshotSecret(key: string, value: string): boolean {
  return sentSecrets.get(key)?.has(value) === true;
}
