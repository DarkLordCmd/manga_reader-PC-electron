import type { CatalogFilters } from '@shared/ipc';

export interface MangalibFilterState {
  sortBy: string;
  order: string;
  types: string[];
  statuses: string[];
  formats: string[];
  ages: string[];
  genres: string[];
  tags: string[];
  countries: string[];
  bookmarks: string[];
  chaptersMin: string;
  chaptersMax: string;
  ratingMin: string;
  ratingMax: string;
  votesMin: string;
  votesMax: string;
  yearMin: string;
  yearMax: string;
}

export interface LibFilterStates {
  mangalib: MangalibFilterState;
  hentailib: MangalibFilterState;
}

export function createEmptyMangalibFilters(): MangalibFilterState {
  return {
    sortBy: '',
    order: 'desc',
    types: [],
    statuses: [],
    formats: [],
    ages: [],
    genres: [],
    tags: [],
    countries: [],
    bookmarks: [],
    chaptersMin: '',
    chaptersMax: '',
    ratingMin: '',
    ratingMax: '',
    votesMin: '',
    votesMax: '',
    yearMin: '',
    yearMax: '',
  };
}

function mangalibFilters(state: MangalibFilterState): CatalogFilters {
  return {
    mangalibTypes: state.types,
    mangalibStatuses: state.statuses,
    mangalibFormats: state.formats,
    mangalibAgeRatings: state.ages,
    mangalibGenres: state.genres,
    mangalibTags: state.tags,
    mangalibCountries: state.countries,
    mangalibBookmarks: state.bookmarks,
    mangalibChaptersMin: state.chaptersMin,
    mangalibChaptersMax: state.chaptersMax,
    mangalibRatingMin: state.ratingMin,
    mangalibRatingMax: state.ratingMax,
    mangalibVotesMin: state.votesMin,
    mangalibVotesMax: state.votesMax,
    mangalibYearMin: state.yearMin,
    mangalibYearMax: state.yearMax,
    mangalibSortBy: state.sortBy,
    mangalibOrder: state.order,
  };
}

/** Keep the IPC payload and cache signature scoped to the active source. */
export function catalogFiltersForSource(
  source: string,
  filters: CatalogFilters,
  libFilters: LibFilterStates,
  showR34: boolean,
): CatalogFilters {
  switch (source) {
    case 'exhentai':
    case 'exhentai_onion':
    case 'ehentai':
      return {
        ehExcludedCats: filters.ehExcludedCats,
        ehMinRating: filters.ehMinRating,
        ehWatchedOnly: filters.ehWatchedOnly,
        ehToplist: filters.ehToplist,
      };
    case 'nhentai':
    case 'nhentai_onion':
      return { nhentaiTags: filters.nhentaiTags };
    case 'mangashi':
      return {
        mangashiPreset: filters.mangashiPreset,
        mangashiSort: filters.mangashiSort,
        mangashiStatus: filters.mangashiStatus,
        mangashiType: filters.mangashiType,
        mangashiYear: filters.mangashiYear,
        mangashiAgeRating: filters.mangashiAgeRating,
        mangashiChaptersMin: filters.mangashiChaptersMin,
        mangashiChaptersMax: filters.mangashiChaptersMax,
        mangashiTags: filters.mangashiTags,
        mangashiExcludeTags: filters.mangashiExcludeTags,
        mangashiBookmarkStatuses: filters.mangashiBookmarkStatuses,
        mangashiHideBookmarked: filters.mangashiHideBookmarked,
      };
    case 'mangalib':
      return mangalibFilters(libFilters.mangalib);
    case 'hentailib':
      return mangalibFilters(libFilters.hentailib);
    case 'remanga':
      return {
        remangaOrdering: filters.remangaOrdering,
        remangaStatus: filters.remangaStatus,
        remangaTypes: filters.remangaTypes,
        remangaGenres: filters.remangaGenres,
        remangaCategories: filters.remangaCategories,
        remangaExcludeGenres: filters.remangaExcludeGenres,
        remangaExcludeCategories: filters.remangaExcludeCategories,
        remangaExcludeTypes: filters.remangaExcludeTypes,
        remangaChaptersMin: filters.remangaChaptersMin,
        remangaChaptersMax: filters.remangaChaptersMax,
        remangaYearMin: filters.remangaYearMin,
        remangaYearMax: filters.remangaYearMax,
        remangaRatingMin: filters.remangaRatingMin,
        remangaRatingMax: filters.remangaRatingMax,
      };
    case 'readmanga':
    case 'mintmanga':
      return {
        readmangaSortType: filters.readmangaSortType,
        readmangaProductionStatuses: filters.readmangaProductionStatuses,
        readmangaTranslationStatuses: filters.readmangaTranslationStatuses,
        readmangaGenres: filters.readmangaGenres,
        readmangaCategories: filters.readmangaCategories,
        readmangaLimitations: filters.readmangaLimitations,
        readmangaAnother: filters.readmangaAnother,
        readmangaSearchFilters: filters.readmangaSearchFilters,
        readmangaExcludeGenres: filters.readmangaExcludeGenres,
        readmangaExcludeCategories: filters.readmangaExcludeCategories,
        readmangaYearMin: filters.readmangaYearMin,
        readmangaYearMax: filters.readmangaYearMax,
      };    case 'mangapoisk':
      return {
        mangapoiskGenres: filters.mangapoiskGenres,
        mangapoiskYears: filters.mangapoiskYears,
        mangapoiskStatus: filters.mangapoiskStatus,
        mangapoiskSortBy: filters.mangapoiskSortBy,
      };    case 'senkuro':
      return {
        senkuroOrdering: filters.senkuroOrdering,
        senkuroStatuses: filters.senkuroStatuses,
        senkuroTypes: filters.senkuroTypes,
        senkuroFormats: filters.senkuroFormats,
        senkuroRatings: showR34
          ? filters.senkuroRatings
          : (filters.senkuroRatings ?? []).filter((rating) => rating !== 'EXPLICIT'),
        senkuroSources: filters.senkuroSources,
        senkuroTranslation: filters.senkuroTranslation,
        senkuroCountries: filters.senkuroCountries,
        senkuroLabels: filters.senkuroLabels,
        senkuroChaptersFrom: filters.senkuroChaptersFrom,
        senkuroChaptersTo: filters.senkuroChaptersTo,
        senkuroYearFrom: filters.senkuroYearFrom,
        senkuroYearTo: filters.senkuroYearTo,
      };
    case 'comx':
      return {
        comxCategory: filters.comxCategory,
        comxGenres: filters.comxGenres,
        comxExcludeGenres: filters.comxExcludeGenres,
        comxTypes: filters.comxTypes,
        comxStatuses: filters.comxStatuses,
        comxAges: filters.comxAges,
        comxYearFrom: filters.comxYearFrom,
        comxYearTo: filters.comxYearTo,
        comxHideMine: filters.comxHideMine,
        comxGenre: filters.comxGenre,
      };
    default:
      return {};
  }
}
