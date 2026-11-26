import { describe, expect, it } from 'vitest';
import { searchGrouple, GROUPLE_SITES } from '../src/main/services/sources/grouple';

const listing = '<html><body><div class="post-description"></div><a href="/manga/test-title" title="Тест"><img src="/cover.jpg"></a></body></html>';

describe('Mangapoisk catalogue filters', () => {
  it('uses the /manga grid and site filter parameters', async () => {
    let called = '';
    const items = await searchGrouple(GROUPLE_SITES[2], '', 1, (url) => {
      called = url;
      return Promise.resolve(listing);
    }, {
      filters: { genres: ['2', '7'], years: ['2020'], status: '1', sortBy: '-year' },
    });

    const url = new URL(called);
    expect(url.pathname).toBe('/manga');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.getAll('genres[]')).toEqual(['2', '7']);
    expect(url.searchParams.getAll('years[]')).toEqual(['2020']);
    expect(url.searchParams.get('translated')).toBe('1');
    expect(url.searchParams.get('sortBy')).toBe('-year');
    expect(items[0]?.url).toBe('https://mangapoisk.me/manga/test-title');
  });

  it('uses the site HTML search page for text queries', async () => {
    let called = '';
    const items = await searchGrouple(GROUPLE_SITES[2], 'наруто', 0, (url) => {
      called = url;
      return Promise.resolve(listing);
    });
    const url = new URL(called);
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('наруто');
    expect(items).toHaveLength(1);
  });
});
