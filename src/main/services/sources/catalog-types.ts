export interface CatalogItem {
  url: string;
  title: string;
  coverUrl: string | null;
  pages: number | null;
  kind?: string | null;
  score?: number | null;
  chapterCount?: number | null;
  /** Adult-only work (18+ badge on the cover) for non-R34 sources. */
  adult?: boolean;
  /** Age rating is 18+ (Senkuro EXPLICIT / Mangalib 18+) — the badge, not the R34 category. */
  age18?: boolean;
  /** Numeric age rating where the source exposes one (Mangalib 1=6+ … 4=18+). */
  ageRestriction?: number | null;
  /** Publication status when the listing provides it (Senkuro search). */
  status?: string | null;
}

export type CatalogSourceKey =
  | 'mangadex'
  | 'exhentai'
  | 'exhentai_onion'
  | 'ehentai'
  | 'nhentai'
  | 'nhentai_onion'
  | 'comx'
  | 'senkuro'
  | 'mangashi'
  | 'remanga'
  | 'mangalib'
  | 'hentailib'
  | 'readmanga'
  | 'mintmanga'
  | 'mangapoisk'
;

export interface CatalogFilters {
  ehExcludedCats?: number;
  mangashiPreset?: string;
  mangashiSort?: string;
  mangashiStatus?: string;
  mangashiType?: string;
  mangashiYear?: string;
  mangashiAgeRating?: string;
  mangashiChaptersMin?: string;
  mangashiChaptersMax?: string;
  mangashiTags?: string[];
  mangashiExcludeTags?: string[];
  mangashiBookmarkStatuses?: string[];
  mangalibTypes?: string[];
  mangalibStatuses?: string[];
  mangalibFormats?: string[];
  mangalibAgeRatings?: string[];
  mangalibGenres?: string[];
  mangalibTags?: string[];
  mangalibCountries?: string[];
  mangalibBookmarks?: string[];
  mangalibChaptersMin?: string;
  mangalibChaptersMax?: string;
  mangalibRatingMin?: string;
  mangalibRatingMax?: string;
  mangalibVotesMin?: string;
  mangalibVotesMax?: string;
  mangalibYearMin?: string;
  mangalibYearMax?: string;
  mangalibSortBy?: string;
  mangalibOrder?: string;
  mangashiHideBookmarked?: boolean;
  remangaOrdering?: string;
  remangaStatus?: string;
  remangaTypes?: string[];
  remangaGenres?: string[];
  remangaCategories?: string[];
  remangaExcludeGenres?: string[];
  remangaExcludeCategories?: string[];
  remangaExcludeTypes?: string[];
  remangaChaptersMin?: string;
  remangaChaptersMax?: string;
  remangaYearMin?: string;
  remangaYearMax?: string;
  remangaRatingMin?: string;
  remangaRatingMax?: string;
  readmangaSortType?: string;
  readmangaProductionStatuses?: string[];
  readmangaTranslationStatuses?: string[];
  readmangaGenres?: string[];
  readmangaCategories?: string[];
  readmangaLimitations?: string[];
  readmangaAnother?: string[];
  readmangaSearchFilters?: string[];
  readmangaExcludeGenres?: string[];
  readmangaExcludeCategories?: string[];
  readmangaYearMin?: string;
  readmangaYearMax?: string;
  mangapoiskGenres?: string[];
  mangapoiskYears?: string[];
  mangapoiskStatus?: string;
  mangapoiskSortBy?: string;
}

export interface SimpleSiteConfig {
  name: string;
  base: string;
  catalogPath: string;
  searchPath: string;
  apiCatalogPath?: string;
  /** Use the JSON catalog API even for the unfiltered default listing. */
  useApiCatalog?: boolean;
  /** HTML catalog with site-specific filter query (Mangapoisk). */
  htmlCatalogMode?: boolean;
  linkMarker: string;
}

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
export const TOR_UA = 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0';

export function siteKeyForUrl(url: string): string | null {
  const l = url.toLowerCase();
  if (l.includes('nhentai')) return 'nhentai';
  if (l.includes('e-hentai.org')) return 'ehentai';
  if (l.includes('com-x.life')) return 'comx';
  if (l.includes('senkuro.')) return 'senkuro';
  if (l.includes('manga-shi.')) return 'mangashi';
  if (l.includes('remanga.')) return 'remanga';
  if (l.includes('hentailib.')) return 'hentailib';
  if (l.includes('mangalib.')) return 'mangalib';
  return null;
}

export function resolve(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
