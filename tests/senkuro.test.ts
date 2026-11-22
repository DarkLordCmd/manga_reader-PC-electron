import { describe, it, expect } from 'vitest';
import { senkuroChapterNumber, senkuroOrderPart, buildSenkuroFilterParts } from '../src/main/services/sources/senkuro';

describe('senkuroOrderPart', () => {
  it('maps the real MangaOrderField enums, not RATING/ID', () => {
    // The API enum only has POPULARITY_SCORE / SCORE / VIEWS / CHAPTERS /
    // CREATED_AT; RATING and ID made every explicit sort fail.
    expect(senkuroOrderPart('score')).toBe('orderBy: { field: SCORE direction: ASC }');
    expect(senkuroOrderPart('-score')).toBe('orderBy: { field: SCORE direction: DESC }');
    expect(senkuroOrderPart('created')).toContain('field: CREATED_AT direction: ASC');
    expect(senkuroOrderPart('-chapters')).toContain('field: CHAPTERS direction: DESC');
    expect(senkuroOrderPart('-views')).toContain('field: VIEWS direction: DESC');
  });

  it('keeps the site default (popularity DESC) when nothing is chosen', () => {
    expect(senkuroOrderPart('')).toBe('orderBy: { field: POPULARITY_SCORE direction: DESC }');
    expect(senkuroOrderPart(undefined)).toContain('POPULARITY_SCORE');
    expect(senkuroOrderPart('   ')).toContain('direction: DESC');
  });
});

describe('buildSenkuroFilterParts', () => {
  it('sends enum filters as {include: [...]} objects', () => {
    const parts = buildSenkuroFilterParts({
      senkuroStatuses: ['ONGOING'],
      senkuroTypes: ['MANHWA'],
      senkuroFormats: ['WEBTOON'],
      senkuroRatings: ['EXPLICIT'],
      senkuroSources: ['ANIME', 'GAME'],
      senkuroTranslation: ['IN_PROGRESS'],
    });
    expect(parts).toContain('status: {include: [ONGOING]}');
    expect(parts).toContain('type: {include: [MANHWA]}');
    expect(parts).toContain('format: {include: [WEBTOON]}');
    expect(parts).toContain('rating: {include: [EXPLICIT]}');
    expect(parts).toContain('source: {include: [ANIME, GAME]}');
    expect(parts).toContain('translitionStatus: {include: [IN_PROGRESS]}');
  });

  it('quotes label slugs and country codes', () => {
    const parts = buildSenkuroFilterParts({ senkuroLabels: ['elf', 'hiding_identity'], senkuroCountries: ['KR', 'JP'] });
    expect(parts).toContain('label: {include: ["elf", "hiding_identity"]}');
    expect(parts).toContain('originCountry: {include: ["KR", "JP"]}');
  });

  it('builds chapters and release-year ranges (0 = unset)', () => {
    expect(buildSenkuroFilterParts({ senkuroChaptersFrom: 100, senkuroChaptersTo: 200 })).toContain('chapters: {start: 100 end: 200}');
    expect(buildSenkuroFilterParts({ senkuroChaptersTo: 200 })).toContain('chapters: {end: 200}');
    expect(buildSenkuroFilterParts({ senkuroYearFrom: 2020, senkuroYearTo: 2022 })).toContain(
      'releasedOn: {start: "2020-01-01" end: "2022-12-31"}',
    );
    expect(buildSenkuroFilterParts({ senkuroChaptersFrom: 0, senkuroYearFrom: 0 })).toEqual([]);
  });

  it('drops empty values and ignores whitespace', () => {
    expect(buildSenkuroFilterParts({ senkuroStatuses: [], senkuroLabels: ['  '] })).toEqual([]);
    expect(buildSenkuroFilterParts(undefined)).toEqual([]);
  });
});

describe('senkuroChapterNumber', () => {
  it('uses the string number the API actually sends', () => {
    expect(senkuroChapterNumber('1', '1')).toBe('1');
    expect(senkuroChapterNumber('42', null)).toBe('42');
    expect(senkuroChapterNumber(7, undefined)).toBe('7');
  });

  it('shows volume prefix when it differs from the chapter number', () => {
    expect(senkuroChapterNumber('5', '2')).toBe('2 / 5');
  });

  it('returns empty when there is no number', () => {
    expect(senkuroChapterNumber(null, '1')).toBe('');
    expect(senkuroChapterNumber(undefined, undefined)).toBe('');
  });
});
