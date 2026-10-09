import { describe, it, expect } from 'vitest';
import { CH } from '../src/shared/ipc';
import { defaultSettings, parseSettings } from '../src/shared/settings';

describe('sync IPC channels', () => {
  it('exposes channels', () => {
    expect(CH.googleAuthStatus).toBe('google:status');
    expect(CH.googleLogin).toBe('google:login');
    expect(CH.googleLogout).toBe('google:logout');
    expect(CH.syncNow).toBe('sync:now');
    expect(CH.syncGetState).toBe('sync:state');
    expect(CH.syncChanged).toBe('sync:changed');
  });
});

describe('sync settings', () => {
  it('defaults', () => {
    expect(defaultSettings().sync_enabled).toBe(false);
    expect(defaultSettings().sync_auto).toBe(true);
    expect(parseSettings({ sync_enabled: true, sync_auto: false }).sync_auto).toBe(false);
  });
});
