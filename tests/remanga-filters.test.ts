import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ httpGetJson: vi.fn() }));
vi.mock('../src/main/services/http', () => ({ httpGetJson: mocks.httpGetJson }));

import { searchRemanga } from '../src/main/services/sources/remanga';

describe('ReManga catalogue filters', () => {
  beforeEach(() => {
    mocks.httpGetJson.mockReset();
    mocks.httpGetJson.mockResolvedValue({ results: [] });
  });

  it('passes site filter names for ranges, types and exclusions', async () => {
    await searchRemanga('filter-test', 0, {
      remangaTypes: ['1', '2'],
      remangaStatus: '2',
      remangaGenres: ['25'],
      remangaCategories: ['64'],
      remangaExcludeGenres: ['2', '40'],
      remangaExcludeCategories: ['5'],
      remangaChaptersMin: '20',
      remangaChaptersMax: '200',
      remangaYearMin: '2020',
      remangaYearMax: '2026',
      remangaRatingMin: '8',
      remangaRatingMax: '10',
    });

    const url = new URL(String(mocks.httpGetJson.mock.calls[0][0]));
    expect(url.searchParams.getAll('types')).toEqual(['1', '2']);
    expect(url.searchParams.get('status')).toBe('2');
    expect(url.searchParams.getAll('genres')).toEqual(['25']);
    expect(url.searchParams.getAll('categories')).toEqual(['64']);
    expect(url.searchParams.getAll('exclude_genres')).toEqual(['2', '40']);
    expect(url.searchParams.getAll('exclude_categories')).toEqual(['5']);
    expect(url.searchParams.get('count_chapters_gte')).toBe('20');
    expect(url.searchParams.get('count_chapters_lte')).toBe('200');
    expect(url.searchParams.get('issue_year_gte')).toBe('2020');
    expect(url.searchParams.get('issue_year_lte')).toBe('2026');
    expect(url.searchParams.get('rating_gte')).toBe('8');
    expect(url.searchParams.get('rating_lte')).toBe('10');
  });
});
