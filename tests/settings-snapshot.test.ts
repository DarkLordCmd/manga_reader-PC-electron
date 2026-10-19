import { describe, it, expect } from 'vitest';
import { rememberSettingsSecrets, isRendererSnapshotSecret } from '../src/main/services/settings-snapshot';
import type { Settings } from '../src/shared/settings';

const s = (cookies: string): Settings => ({ onion_cookies_raw: cookies }) as unknown as Settings;

describe('settings secret snapshot', () => {
  it('recognises the exact value handed to the renderer', () => {
    rememberSettingsSecrets(s('onikakushi=old'));
    expect(isRendererSnapshotSecret('onion_cookies_raw', 'onikakushi=old')).toBe(true);
  });
  it('does not treat a fresh login value as a stale snapshot', () => {
    rememberSettingsSecrets(s('onikakushi=old'));
    expect(isRendererSnapshotSecret('onion_cookies_raw', 'onikakushi=new')).toBe(false);
  });
  it('still recognises an older echo after a newer broadcast', () => {
    rememberSettingsSecrets(s('onikakushi=one'));
    rememberSettingsSecrets(s('onikakushi=two'));
    expect(isRendererSnapshotSecret('onion_cookies_raw', 'onikakushi=one')).toBe(true);
    expect(isRendererSnapshotSecret('onion_cookies_raw', 'onikakushi=two')).toBe(true);
    expect(isRendererSnapshotSecret('onion_cookies_raw', 'onikakushi=three')).toBe(false);
  });
});
