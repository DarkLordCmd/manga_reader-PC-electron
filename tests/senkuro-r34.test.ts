import { describe, it, expect } from 'vitest';
import { senkuroSlugFromUrl } from '../src/main/services/senkuro-r34';
import { InMemorySeriesRepository } from '../src/main/services/series-repository';

describe('Senkuro R34 backfill helpers', () => {
  it('extracts the manga slug from library URLs', () => {
    expect(senkuroSlugFromUrl('https://senkuro.me/manga/college-hot-girlfriends/')).toBe('college-hot-girlfriends');
    expect(senkuroSlugFromUrl('https://senkuro.com/manga/moby-dick-yansae')).toBe('moby-dick-yansae');
    expect(senkuroSlugFromUrl('https://senkuro.me/manga/with%20space/')).toBe('with space');
    expect(senkuroSlugFromUrl('https://senkuro.me/manga/')).toBeNull();
    expect(senkuroSlugFromUrl('https://example.com/g/1/')).toBeNull();
  });

  it('setCategory moves a library row to r34 (in-memory repo)', () => {
    const repo = new InMemorySeriesRepository();
    repo.upsertHistory({
      key: 'k',
      seriesId: 'https://senkuro.me/manga/x/',
      url: 'https://senkuro.me/manga/x/',
      title: 'X',
      coverUrl: null,
      source: 'Senkuro',
      category: 'main',
      currentPage: 1,
      totalPages: 0,
      chapterLabel: '1',
      chapterIndex: 0,
      chapterTotal: 10,
    });
    expect(repo.get('k')?.category).toBe('main');
    repo.setCategory('k', 'r34');
    expect(repo.get('k')?.category).toBe('r34');
  });
});
