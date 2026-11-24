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
const SLUG_STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'no', 'na', 'de', 'la', 'le', 'wa', 'ga',
  'part', 'chapter', 'manga', 'manhwa', 'manhua',
]);

/** Tokens of the source slug (`/manga/<dir>/`), e.g. Remanga/Senkuro keys.
 * Different Russian titles for the same Korean/Japanese work still share the
 * transliterated slug words: "hero-high-school-dungeon-attack-department" and
 * "warrior-high-school-dungeon-raid-department". */
export function workSlugTokens(url: string): string[] {
  const m = String(url ?? '').match(/\/manga\/([^/?#]+)/i);
  if (!m) return [];
  return decodeURIComponent(m[1])
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .split(/[^a-z0-9а-яё]+/i)
    .filter((t) => t.length > 1 && !SLUG_STOP.has(t));
}

function dice(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const common = a.reduce((n, t) => n + (setB.has(t) ? 1 : 0), 0);
  return (2 * common) / (a.length + b.length);
}

/** Same work on two sources: exact normalized title OR very similar slug
 * (localizations often have completely different Russian titles). */
export function likelySameWork(a: { url: string; title: string }, b: { url: string; title: string }): boolean {
  const ta = normalizeWorkTitle(a.title);
  const tb = normalizeWorkTitle(b.title);
  if (ta.length >= 4 && ta === tb) return true;
  const sa = workSlugTokens(a.url);
  const sb = workSlugTokens(b.url);
  if (sa.length < 4 || sb.length < 4) return false;
  const setB = new Set(sb);
  const common = sa.filter((t) => setB.has(t)).length;
  return common >= 4 && dice(sa, sb) >= 0.6;
}

/** Union-find grouping so transitive matches stay in one card. */
export function groupLikelyWorks<T extends { url: string; title: string }>(items: T[]): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const matches = groups.filter((g) => g.some((x) => likelySameWork(item, x)));
    if (matches.length === 0) {
      groups.push([item]);
      continue;
    }
    const [first, ...rest] = matches;
    first.push(item);
    for (const g of rest) {
      first.push(...g);
      groups.splice(groups.indexOf(g), 1);
    }
  }
  return groups;
}