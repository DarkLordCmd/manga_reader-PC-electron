import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: () => '' },
  dialog: {},
}));

import { ipcMain } from 'electron';
import { CH } from '../src/shared/ipc';
import { defaultSettings } from '../src/shared/settings';
import { registerSettings } from '../src/main/ipc/settings';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

describe('settings IPC secret redaction', () => {
  const handlers = new Map<string, Handler>();
  let saveMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handlers.clear();
    vi.mocked(ipcMain.handle).mockImplementation((channel, listener) => {
      handlers.set(channel, listener as Handler);
    });
    const current = {
      ...defaultSettings(),
      remanga_token: 'bearer-secret',
      remanga_cookies_raw: 'sessionid=secret',
      remanga_user_id: 42,
      remanga_username: 'reader',
    };
    saveMock = vi.fn();
    registerSettings({
      settings: { get: () => current, save: saveMock } as never,
      repo: {} as never,
      exAccounts: {} as never,
      downloads: {} as never,
      db: { pragma: vi.fn() },
      coverCache: new Map(),
      getCoverDisk: () => ({}) as never,
      broadcastSettingsChanged: vi.fn(),
      broadcastLibraryChanged: vi.fn(),
      effectiveTorSocks: () => '',
      downloadsDirBase: () => '',
    });
  });

  it('never exposes the Remanga bearer token to the renderer', () => {
    const snapshot = handlers.get(CH.getSettings)!({ sender: { id: 1 } }) as ReturnType<typeof defaultSettings>;
    expect(snapshot).toMatchObject({
      remanga_token: '',
      remanga_cookies_raw: '',
      remanga_user_id: 42,
      remanga_username: 'reader',
    });
  });

  it('ignores renderer attempts to replace or blank Remanga credentials', () => {
    const handler = handlers.get(CH.setSettings)!;
    handler(
      { sender: { id: 1 } },
      {
        ...defaultSettings(),
        width_scale: 0.7,
        remanga_token: 'injected-token',
        remanga_cookies_raw: 'sessionid=injected',
      },
    );

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        width_scale: 0.7,
        remanga_token: 'bearer-secret',
        remanga_cookies_raw: 'sessionid=secret',
      }),
    );
  });
});
