import { beforeEach, describe, expect, it, vi } from 'vitest';

const { httpFetchMock } = vi.hoisted(() => ({ httpFetchMock: vi.fn() }));

vi.mock('../src/main/services/http', () => ({
  httpFetch: httpFetchMock,
}));

import { runSenkuroImport } from '../src/main/services/senkuro-import';
import { LibraryService } from '../src/main/services/library';
import { HistoryManager } from '../src/main/services/history';
import { InMemorySeriesRepository } from '../src/main/services/series-repository';
import { defaultSettings } from '../src/shared/settings';

function mockBookmarks(entities: { slug: string | null; title: string }[]): void {
  httpFetchMock.mockImplementation(async (request: { body: string }) => {
    if (request.body.includes('viewer')) {
      return {
        status: 200,
        text: JSON.stringify({
          data: {
            viewer: {
              user: { id: 'user-1' },
              userBookmarkCollections: [
                { id: 'collection-1', slug: 'watching', name: 'Читаю', entityType: 'MANGA', status: 'WATCHING', system: true },
              ],
            },
          },
        }),
      };
    }
    return {
      status: 200,
      text: JSON.stringify({
        data: {
          userBookmarks: {
            edges: entities.map((entity, index) => ({
              node: {
                entityId: String(index),
                collectionId: 'collection-1',
                page: 7,
                number: '5',
                entity: { ...entity, titles: [{ lang: 'RU', content: entity.title }], chapters: 20 },
              },
            })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    };
  });
}

function deps() {
  const repo = new InMemorySeriesRepository();
  const current = { ...defaultSettings(), senkuro_cookies_raw: 'access_token=token' };
  return {
    repo,
    library: new LibraryService(repo, { autoAdd: () => true }),
    history: new HistoryManager(repo),
    settings: { get: () => current, save: vi.fn() },
  };
}

describe('Senkuro bookmark import service', () => {
  beforeEach(() => {
    httpFetchMock.mockReset();
  });

  it('skips slugless entities instead of merging them into one empty series key', async () => {
    mockBookmarks([
      { slug: null, title: 'Без slug один' },
      { slug: null, title: 'Без slug два' },
      { slug: 'valid-title', title: 'Нормальная работа' },
    ]);
    const d = deps();
    const result = await runSenkuroImport(d, { markRead: false });

    expect(result.imported).toBe(1);
    expect(result.errors).toBe(2);
    expect(d.repo.all().map((row) => row.url)).toEqual(['https://senkuro.me/manga/valid-title/']);
  });

  it('stores the bookmark resume page in library/history progress', async () => {
    mockBookmarks([{ slug: 'paged-title', title: 'Работа со страницей' }]);
    const d = deps();
    await runSenkuroImport(d, { markRead: false });
    expect(d.repo.all()[0].currentPage).toBe(7);
  });
});
