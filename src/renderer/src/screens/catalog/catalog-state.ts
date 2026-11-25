import type { QuickSearch } from '@shared/quick-search';
import { R34_SOURCES, SOURCES } from './constants';

export interface CatalogSourceOption {
  key: string;
  label: string;
}

export const DEFAULT_CATALOG_SOURCE = 'comx';

export function visibleCatalogSources(showR34: boolean): CatalogSourceOption[] {
  return showR34 ? SOURCES : SOURCES.filter((source) => !R34_SOURCES.includes(source.key));
}

export function resolveCatalogSource(candidate: string | null | undefined, showR34: boolean): string {
  const key = candidate?.trim() ?? '';
  if (key && visibleCatalogSources(showR34).some((source) => source.key === key)) return key;
  return SOURCES.find((source) => !R34_SOURCES.includes(source.key))?.key ?? DEFAULT_CATALOG_SOURCE;
}

export function isQuickSearchVisible(search: QuickSearch, showR34: boolean): boolean {
  const known = SOURCES.some((source) => source.key === search.source);
  return known && (showR34 || !R34_SOURCES.includes(search.source));
}

export function visibleQuickSearchesFor(searches: readonly QuickSearch[], showR34: boolean): QuickSearch[] {
  return searches.filter((search) => isQuickSearchVisible(search, showR34));
}
