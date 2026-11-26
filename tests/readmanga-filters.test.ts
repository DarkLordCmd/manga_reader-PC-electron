import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { searchGrouple, GROUPLE_SITES } from '../src/main/services/sources/grouple';

const searchJson = readFileSync(join('tests', 'fixtures', 'grouple-search-api.json'), 'utf-8');

describe('Readmanga advanced filters', () => {
  it('builds the catalog API query with repeated element/status filters', async () => {
    let called = '';
    const items = await searchGrouple(GROUPLE_SITES[0], '', 1, (url) => {
      called = url;
      return Promise.resolve(searchJson);
    }, {
      filters: {
        sortType: 'USER_RATING',
        productionStatuses: ['FINISHED', 'PROGRESS'],
        translationStatuses: ['STARTED'],
        elementIds: ['9451', '2131'],
        excludeElementIds: ['3001'],
        searchFilters: ['HIGH_RATE'],
        yearMin: '2020',
        yearMax: '2026',
      },
    });

    const url = new URL(called);
    expect(url.pathname).toBe('/api/catalog/search');
    expect(url.searchParams.get('offset')).toBe('50');
    expect(url.searchParams.get('sortType')).toBe('USER_RATING');
    expect(url.searchParams.get('years')).toBe('2020,2026');
    expect(url.searchParams.getAll('includeElementIds')).toEqual(['9451', '2131']);
    expect(url.searchParams.getAll('excludeElementIds')).toEqual(['3001']);
    expect(url.searchParams.getAll('includeProductionStatuses')).toEqual(['FINISHED', 'PROGRESS']);
    expect(url.searchParams.getAll('includeTranslationStatuses')).toEqual(['STARTED']);
    expect(url.searchParams.getAll('includeSearchFilter')).toEqual(['HIGH_RATE']);
    expect(items).toHaveLength(2);
  });
});
