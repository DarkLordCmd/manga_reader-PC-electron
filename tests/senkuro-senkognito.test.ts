import { describe, it, expect } from 'vitest';
import { buildSenkognitoVars, senkuroAdultFromRating, senkuroAge18 } from '../src/main/services/sources/senkuro';

describe('Senkognito 18+ catalogue variables', () => {
  it('maps search, filters, pagination and default ordering', () => {
    const v = buildSenkognitoVars(
      ' married ',
      {
        senkuroStatuses: ['ONGOING'],
        senkuroTypes: ['MANHWA'],
        senkuroFormats: ['WEBTOON'],
        senkuroRatings: ['EXPLICIT'],
        senkuroSources: ['ORIGINAL'],
        senkuroTranslation: ['IN_PROGRESS'],
        senkuroCountries: ['KR'],
        senkuroLabels: ['romance'],
        senkuroChaptersFrom: 20,
        senkuroChaptersTo: 100,
        senkuroYearFrom: 2020,
        senkuroYearTo: 2024,
      },
      'cursor1',
    );
    expect(v).toMatchObject({
      after: 'cursor1',
      search: 'married',
      rating: { include: ['EXPLICIT'], exclude: [] },
      type: { include: ['MANHWA'], exclude: [] },
      format: { include: ['WEBTOON'], exclude: [] },
      status: { include: ['ONGOING'], exclude: [] },
      source: { include: ['ORIGINAL'], exclude: [] },
      translitionStatus: { include: ['IN_PROGRESS'], exclude: [] },
      originCountry: { include: ['KR'], exclude: [] },
      label: { include: ['romance'], exclude: [] },
      chapters: { start: 20, end: 100 },
      releasedOn: { start: '2020-01-01', end: '2024-12-31' },
      orderField: 'POPULARITY_SCORE',
      orderDirection: 'DESC',
    });
  });

  it('maps the sort direction like the main catalogue', () => {
    expect(buildSenkognitoVars('', { senkuroOrdering: '-score' })).toMatchObject({
      orderField: 'SCORE',
      orderDirection: 'DESC',
    });
    expect(buildSenkognitoVars('', { senkuroOrdering: 'score' })).toMatchObject({
      orderField: 'SCORE',
      orderDirection: 'ASC',
    });
    expect(buildSenkognitoVars('', { senkuroOrdering: '-created' })).toMatchObject({
      orderField: 'CREATED_AT',
      orderDirection: 'DESC',
    });
  });

  it('sends empty filter objects when nothing is selected', () => {
    const v = buildSenkognitoVars('', undefined);
    expect(v.chapters).toEqual({});
    expect(v.releasedOn).toEqual({});
    expect(v.search).toBeNull();
    expect(v.after).toBeNull();
    expect((v.rating as { include: string[] }).include).toEqual([]);
  });
});

describe('Senkuro adult rating', () => {
  it('treats only EXPLICIT (18+) as R34', () => {
    expect(senkuroAdultFromRating('EXPLICIT')).toBe(true);
    expect(senkuroAdultFromRating('explicit')).toBe(true);
    expect(senkuroAdultFromRating('QUESTIONABLE')).toBe(false);
    expect(senkuroAdultFromRating('SENSITIVE')).toBe(false);
    expect(senkuroAdultFromRating(null)).toBe(false);
  });
});

describe('Senkuro age rating badge', () => {
  it('marks EXPLICIT as 18+ regardless of R34 labels', () => {
    expect(senkuroAge18('EXPLICIT')).toBe(true);
    expect(senkuroAge18('explicit')).toBe(true);
    expect(senkuroAge18('QUESTIONABLE')).toBe(false);
    expect(senkuroAge18('SENSITIVE')).toBe(false);
    expect(senkuroAge18(null)).toBe(false);
  });
});