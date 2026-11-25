import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mangalibChapters: vi.fn(),
  mangalibChapterUrl: vi.fn(),
  mangalibChapterSortKey: vi.fn(),
  mangalibChapterTitle: vi.fn(),
}));

vi.mock('../src/main/services/sources/mangalib', () => ({
  mangalibChapters: mocks.mangalibChapters,
  mangalibChapterUrl: mocks.mangalibChapterUrl,
  mangalibChapterSortKey: mocks.mangalibChapterSortKey,
  mangalibChapterTitle: mocks.mangalibChapterTitle,
}));

import { registerCatalog } from '../src/main/ipc/catalog';
import { defaultSettings } from '../src/shared/settings';

describe('lib.social chapter list IPC', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.mangalibChapters.mockResolvedValue([
      { id: 428152, volume: '1', number: '18.5', numberSecondary: '1', name: 'арты' },
    ]);
    mocks.mangalibChapterUrl.mockReturnValue('https://hentailib.me/ru/19009--the-little-trashmaid/read/v1/c18.5');
    mocks.mangalibChapterSortKey.mockReturnValue(1);
    mocks.mangalibChapterTitle.mockReturnValue('Том 1 Глава 18.5 — арты');
  });

  it('uses the API chapter number without appending number_secondary to the label', async () => {
    const catalog = registerCatalog({
      settings: { get: () => defaultSettings() } as never,
      effectiveTorSocks: () => '',
      exAccounts: {} as never,
      whenEmbeddedTorReady: async () => undefined,
      refreshGroupleCache: async () => undefined,
      broadcastNhentaiCounts: vi.fn(),
    });

    const chapters = await catalog.fetchChapterListFor('https://hentailib.me/ru/manga/19009--the-little-trashmaid');

    expect(chapters[0]?.chapter_num).toBe('Том 1 Глава 18.5 — арты');
    expect(mocks.mangalibChapterTitle).toHaveBeenCalledWith(expect.objectContaining({ number: '18.5', numberSecondary: '1' }));
  });
});
