import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { searchGrouple, GROUPLE_SITES } from '../src/main/services/sources/grouple';

const searchJson = readFileSync(join('tests', 'fixtures', 'grouple-search-api.json'), 'utf-8');

describe('Mintmanga catalogue API', () => {
  it('uses the working host and JSON API for the default listing', async () => {
    let called = '';
    const items = await searchGrouple(GROUPLE_SITES[1], '', 0, (url) => {
      called = url;
      return Promise.resolve(searchJson);
    });

    const url = new URL(called);
    expect(GROUPLE_SITES[1].base).toBe('https://1.mintmanga.com');
    expect(url.pathname).toBe('/api/catalog/search');
    expect(url.searchParams.get('sortType')).toBe('RATING');
    expect(url.searchParams.get('years')).toBe('1950,2027');
    expect(items).toHaveLength(2);
  });

  it('sends Mintmanga element/status filters', async () => {
    let called = '';
    await searchGrouple(GROUPLE_SITES[1], '', 0, (url) => {
      called = url;
      return Promise.resolve(searchJson);
    }, {
      filters: {
        sortType: 'USER_RATING',
        elementIds: ['1313', '6421'],
        productionStatuses: ['FINISHED'],
        translationStatuses: ['STARTED'],
        yearMin: '2018',
        yearMax: '2026',
      },
    });

    const url = new URL(called);
    expect(url.searchParams.getAll('includeElementIds')).toEqual(['1313', '6421']);
    expect(url.searchParams.getAll('includeProductionStatuses')).toEqual(['FINISHED']);
    expect(url.searchParams.getAll('includeTranslationStatuses')).toEqual(['STARTED']);
    expect(url.searchParams.get('years')).toBe('2018,2026');
  });
});
