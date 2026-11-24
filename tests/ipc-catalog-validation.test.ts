import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: () => '' },
}));

import { ipcMain } from 'electron';
import { CH } from '../src/shared/ipc';
import { defaultSettings } from '../src/shared/settings';
import { registerCatalog } from '../src/main/ipc/catalog';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

describe('catalog IPC cursor validation', () => {
  const handlers = new Map<string, Handler>();

  beforeEach(() => {
    handlers.clear();
    vi.mocked(ipcMain.handle).mockImplementation((channel, listener) => {
      handlers.set(channel, listener as Handler);
    });
    registerCatalog({
      settings: { get: () => defaultSettings() } as never,
      effectiveTorSocks: () => '',
      exAccounts: {} as never,
      whenEmbeddedTorReady: async () => undefined,
      refreshGroupleCache: async () => undefined,
      broadcastNhentaiCounts: vi.fn(),
    });
  });

  it('rejects a cursor with an invalid direction or non-string token', async () => {
    const handler = handlers.get(CH.searchCatalog)!;
    await expect(
      Promise.resolve().then(() =>
        handler({ sender: { id: 1 } }, 'unknown', '', 0, '', {}, { dir: 'sideways', cursor: 42 }),
      ),
    ).rejects.toThrow(/Недопустимые аргументы/);
  });

  it('continues to accept an omitted cursor', async () => {
    const handler = handlers.get(CH.searchCatalog)!;
    await expect(handler({ sender: { id: 1 } }, 'unknown', '', 0, '')).resolves.toEqual([]);
  });
});
