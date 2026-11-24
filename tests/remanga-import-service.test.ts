import { beforeEach, describe, expect, it, vi } from 'vitest';

const { httpGetJsonMock } = vi.hoisted(() => ({ httpGetJsonMock: vi.fn() }));

vi.mock('../src/main/services/http', () => ({
  httpGetJson: httpGetJsonMock,
  httpPostJson: vi.fn(),
}));

import { importRemangaBookmarks } from '../src/main/services/remanga-import';
import { LibraryService } from '../src/main/services/library';
import { HistoryManager } from '../src/main/services/history';
import { InMemorySeriesRepository } from '../src/main/services/series-repository';

function deps() {
  const repo = new InMemorySeriesRepository();
  return {
    repo,
    library: new LibraryService(repo, { autoAdd: () => true }),
    history: new HistoryManager(repo),
  };
}

function mockLists(types: number[]): void {
  httpGetJsonMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/user_bookmarks/')) {
      return { results: types.map((type) => ({ id: type === 7 ? 70 : 10, name: '', count: 1, type })) };
    }
    const type = Number(new URL(url).searchParams.get('type'));
    return {
      results: [
        {
          title: { dir: 'dual-title', rus_name: 'Двойная закладка', count_chapters: 20 },
          chapter: { chapter: '5', index: 4 },
          read_progress: 5,
          page: 7,
        },
      ],
      next: null,
    };
  });
}

describe('Remanga bookmark import service', () => {
  beforeEach(() => {
    httpGetJsonMock.mockReset();
  });

  it.each([
    ['reading then favorite', [1, 7]],
    ['favorite then reading', [7, 1]],
  ])('merges one work present in both lists (%s)', async (_name, types) => {
    mockLists(types);
    const d = deps();
    const result = await importRemangaBookmarks(d, { token: 'token' }, 1);
    const row = d.repo.all()[0];

    expect(result.imported).toBe(1);
    expect(row.status).toBe('reading');
    expect(row.favoritedAt).not.toBeNull();
  });

  it('does not count different untitled works as title duplicates', async () => {
    httpGetJsonMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/user_bookmarks/')) {
        return { results: [{ id: 10, name: 'Читаю', count: 2, type: 1 }] };
      }
      return {
        results: [
          { title: { dir: 'first-untitled', rus_name: 'Без названия' } },
          { title: { dir: 'second-untitled', rus_name: 'Без названия' } },
        ],
        next: null,
      };
    });
    const d = deps();
    const result = await importRemangaBookmarks(d, { token: 'token' }, 1);

    expect(result.imported).toBe(2);
    expect(result.duplicates).toBe(0);
    expect(d.repo.all()).toHaveLength(2);
  });

  it('imports the bookmark resume page instead of resetting it to page 1', async () => {
    mockLists([1]);
    const d = deps();
    await importRemangaBookmarks(d, { token: 'token' }, 1);
    expect(d.repo.all()[0].currentPage).toBe(7);
  });
});
