import { describe, expect, it } from 'vitest';
import {
  catalogFiltersForSource,
  createEmptyMangalibFilters,
  type MangalibFilterState,
} from '../src/renderer/src/screens/catalog/catalog-filters';
import type { CatalogFilters } from '../src/shared/ipc';

const allFilters: CatalogFilters = {
  ehExcludedCats: 2,
  ehMinRating: 4,
  ehWatchedOnly: true,
  ehToplist: 11,
  nhentaiTags: ['female:sole'],
  mangashiPreset: 'popular',
  mangashiSort: 'rating',
  mangashiStatus: 'COMPLETED',
  mangashiType: 'MANGA',
  mangashiYear: '2024',
  mangashiAgeRating: 'sfw',
  mangashiChaptersMin: '10',
  mangashiChaptersMax: '20',
  mangashiTags: ['tag-a'],
  mangashiExcludeTags: ['tag-b'],
  mangashiBookmarkStatuses: ['READING'],
  mangashiHideBookmarked: true,
  remangaOrdering: '-rating',
  remangaStatus: '2',
  remangaTypes: ['1'],
  remangaGenres: ['25'],
  remangaCategories: ['64'],
  remangaExcludeGenres: ['40'],
  remangaExcludeCategories: ['5'],
  remangaExcludeTypes: ['2'],
  remangaChaptersMin: '20',
  remangaChaptersMax: '200',
  remangaYearMin: '2020',
  remangaYearMax: '2026',
  remangaRatingMin: '8',
  remangaRatingMax: '10',
  senkuroOrdering: '-score',
  senkuroStatuses: ['ONGOING'],
  senkuroTypes: ['MANHWA'],
  senkuroFormats: ['WEBTOON'],
  senkuroRatings: ['GENERAL', 'EXPLICIT'],
  senkuroSources: ['ANIME'],
  senkuroTranslation: ['IN_PROGRESS'],
  senkuroCountries: ['JP'],
  senkuroLabels: ['elf'],
  senkuroChaptersFrom: 10,
  senkuroChaptersTo: 20,
  senkuroYearFrom: 2020,
  senkuroYearTo: 2026,
  comxCategory: '44',
  comxGenres: ['29'],
  comxExcludeGenres: ['64'],
  comxTypes: ['3'],
  comxStatuses: ['2'],
  comxAges: ['5'],
  comxYearFrom: '2020',
  comxYearTo: '2025',
  comxHideMine: true,
  comxGenre: '29',
};

const mangalib: MangalibFilterState = {
  ...createEmptyMangalibFilters(),
  genres: ['34'],
  tags: ['271'],
  sortBy: 'rate_avg',
};
const hentailib: MangalibFilterState = {
  ...createEmptyMangalibFilters(),
  genres: ['71'],
  tags: ['307'],
  sortBy: 'views',
};
const libStates = { mangalib, hentailib };

describe('catalog filter isolation', () => {
  it('sends only Com-X fields to Com-X', () => {
    expect(catalogFiltersForSource('comx', allFilters, libStates, false)).toEqual({
      comxCategory: '44',
      comxGenres: ['29'],
      comxExcludeGenres: ['64'],
      comxTypes: ['3'],
      comxStatuses: ['2'],
      comxAges: ['5'],
      comxYearFrom: '2020',
      comxYearTo: '2025',
      comxHideMine: true,
      comxGenre: '29',
    });
  });

  it('sends only ReManga fields to ReManga', () => {
    expect(catalogFiltersForSource('remanga', allFilters, libStates, false)).toEqual({
      remangaOrdering: '-rating',
      remangaStatus: '2',
      remangaTypes: ['1'],
      remangaGenres: ['25'],
      remangaCategories: ['64'],
      remangaExcludeGenres: ['40'],
      remangaExcludeCategories: ['5'],
      remangaExcludeTypes: ['2'],
      remangaChaptersMin: '20',
      remangaChaptersMax: '200',
      remangaYearMin: '2020',
      remangaYearMax: '2026',
      remangaRatingMin: '8',
      remangaRatingMax: '10',
    });
  });

  it('keeps Mangalib and HentaiLIB filter state isolated', () => {
    expect(catalogFiltersForSource('mangalib', allFilters, libStates, true)).toMatchObject({
      mangalibGenres: ['34'],
      mangalibTags: ['271'],
      mangalibSortBy: 'rate_avg',
    });
    expect(catalogFiltersForSource('hentailib', allFilters, libStates, true)).toMatchObject({
      mangalibGenres: ['71'],
      mangalibTags: ['307'],
      mangalibSortBy: 'views',
    });
  });

  it('does not leak E-Hentai, Manga-shi, Senkuro or Com-X fields into lib.social requests', () => {
    for (const source of ['mangalib', 'hentailib']) {
      const filters = catalogFiltersForSource(source, allFilters, libStates, true);
      expect(Object.keys(filters).every((key) => key.startsWith('mangalib'))).toBe(true);
    }
  });

  it('drops EXPLICIT from Senkuro without mutating the saved selection', () => {
    const filters = catalogFiltersForSource('senkuro', allFilters, libStates, false);
    expect(filters).toEqual({
      senkuroOrdering: '-score',
      senkuroStatuses: ['ONGOING'],
      senkuroTypes: ['MANHWA'],
      senkuroFormats: ['WEBTOON'],
      senkuroRatings: ['GENERAL'],
      senkuroSources: ['ANIME'],
      senkuroTranslation: ['IN_PROGRESS'],
      senkuroCountries: ['JP'],
      senkuroLabels: ['elf'],
      senkuroChaptersFrom: 10,
      senkuroChaptersTo: 20,
      senkuroYearFrom: 2020,
      senkuroYearTo: 2026,
    });
    expect(allFilters.senkuroRatings).toEqual(['GENERAL', 'EXPLICIT']);
  });

  it('returns no source filters for sources without a filter panel', () => {
    expect(catalogFiltersForSource('readmanga', allFilters, libStates, true)).toEqual({});
  });
});
