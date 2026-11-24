import type { LibraryItem, ReadingStatus } from '@shared/library';

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/** Builds a lookup for cover badges from library rows. Cards in History and
 * Popular reference works by chapter URL, series URL or internal key, so all
 * three identifiers are indexed in both their original and normalized forms. */
export function toStatusMap(items: LibraryItem[]): Record<string, ReadingStatus> {
  const map: Record<string, ReadingStatus> = {};
  for (const item of items) {
    if (!item.status) continue;
    for (const url of [item.url, item.seriesId, item.key]) {
      map[url] = item.status;
      map[normalizeUrl(url)] = item.status;
    }
  }
  return map;
}
