/** Normalizes a work title for cross-source duplicate matching (same title on
 * Senkuro/Remanga/MangaDex/etc.). Deliberately conservative: only the title
 * itself, volume/chapter suffixes and bracketed metadata are stripped. */
export function normalizeWorkTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(/\((?:[^)]*(?:ремейк|remake|новелла|novel|манхва|манга|manhwa|manga)[^)]*)\)/gi, ' ')
    .replace(/\((?:[^)]*)\)/g, ' ')
    .replace(/\s+(?:том|глава|chapter|vol(?:ume)?|tome)\s*[.:-]?\s*\d+.*$/iu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
