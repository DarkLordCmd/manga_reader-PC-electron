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

/** Human chapter label, stripped of volume prefixes: "1 / 148" → "148",
 * "Том 1 Глава 2" → "2". Returns null when no number is present. */
export function chapterLabelNumber(label: unknown): string | null {
  const text = String(label ?? '').trim();
  if (!text) return null;
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*$/);
  return m ? m[1].replace(',', '.') : null;
}