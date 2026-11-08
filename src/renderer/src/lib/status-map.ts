import type { LibraryItem, ReadingStatus } from '@shared/library';

/** Builds a lookup for cover badges from library rows. Cards in History and
 * Popular reference works by chapter URL, series URL or internal key, so all
 * three identifiers are indexed. */
export function toStatusMap(items: LibraryItem[]): Record<string, ReadingStatus> {
  const map: Record<string, ReadingStatus> = {};
  for (const item of items) {
    if (!item.status) continue;
    map[item.url] = item.status;
    map[item.seriesId] = item.status;
    map[item.key] = item.status;
  }
  return map;
}
