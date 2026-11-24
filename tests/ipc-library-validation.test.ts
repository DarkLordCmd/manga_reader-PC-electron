import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import { CH } from '../src/shared/ipc';
import { registerLibrary } from '../src/main/ipc/library';
import { LibraryService } from '../src/main/services/library';
import { HistoryManager } from '../src/main/services/history';
import { InMemorySeriesRepository } from '../src/main/services/series-repository';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

describe('library IPC validation', () => {
  const handlers = new Map<string, Handler>();
  let repo: InMemorySeriesRepository;

  beforeEach(() => {
    handlers.clear();
    vi.mocked(ipcMain.handle).mockImplementation((channel, listener) => {
      handlers.set(channel, listener as Handler);
    });
    repo = new InMemorySeriesRepository([
      {
        key: 'series-1',
        seriesId: 'series-1',
        url: 'https://example.com/series-1',
        title: 'Series',
        coverUrl: null,
        source: 'Example',
        category: 'main',
        currentPage: 1,
        totalPages: 10,
        chapterLabel: null,
        chapterIndex: null,
        chapterTotal: null,
        status: 'reading',
        note: '',
        rating: null,
        tags: [],
        openedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
        favoritedAt: null,
      },
    ]);
    registerLibrary({
      library: new LibraryService(repo, { autoAdd: () => true }),
      history: new HistoryManager(repo),
      settings: {} as never,
      broadcastLibrary: vi.fn(),
    });
  });

  it('rejects an unknown reading status without mutating the series', async () => {
    const handler = handlers.get(CH.librarySetStatus)!;
    await expect(Promise.resolve().then(() => handler({ sender: { id: 1 } }, 'series-1', 'not-a-status'))).rejects.toThrow(
      /Недопустимые аргументы/,
    );
    expect(repo.get('series-1')?.status).toBe('reading');
  });

  it('rejects malformed library query fields at the IPC boundary', async () => {
    const handler = handlers.get(CH.libraryList)!;
    await expect(Promise.resolve().then(() => handler({ sender: { id: 1 } }, { search: 42 }))).rejects.toThrow(
      /Недопустимые аргументы/,
    );
  });
});
