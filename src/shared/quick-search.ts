export interface QuickSearch {
  id: string;
  name: string;
  source: string;
  query: string;
  /** E-Hentai category exclusion bitmask (same value as `CatalogFilters.ehExcludedCats`). */
  ehExcludedCats?: number;
  /** Minimum rating (0 = any). */
  ehMinRating?: number;
}

export function normalizeQuickSearches(raw: unknown): QuickSearch[] {
  if (!Array.isArray(raw)) return [];
  const out: QuickSearch[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || typeof o.name !== 'string') continue;
    const q: QuickSearch = {
      id: o.id,
      name: o.name,
      source: typeof o.source === 'string' && o.source ? o.source : 'exhentai',
      query: typeof o.query === 'string' ? o.query : '',
    };
    if (typeof o.ehExcludedCats === 'number' && isFinite(o.ehExcludedCats)) q.ehExcludedCats = o.ehExcludedCats;
    if (typeof o.ehMinRating === 'number' && isFinite(o.ehMinRating)) q.ehMinRating = o.ehMinRating;
    out.push(q);
  }
  return out;
}

export function addQuickSearch(list: QuickSearch[], entry: QuickSearch): QuickSearch[] {
  return [...list, entry];
}

export function removeQuickSearch(list: QuickSearch[], id: string): QuickSearch[] {
  return list.filter((q) => q.id !== id);
}

export function moveQuickSearch(list: QuickSearch[], id: string, dir: 'up' | 'down'): QuickSearch[] {
  const i = list.findIndex((q) => q.id === id);
  if (i < 0) return list;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Splits an E-Hentai search expression (as saved in a quick-search preset)
 * into free-text `keyword` and tag-bar `tags`. Tag tokens (namespace:tag or an
 * exclusion) go to the tag bar; exclusions keep the UI's `!` marker and quotes
 * / the `$` exact-match suffix are stripped. */
export function parseEhQueryToTags(query: string): { keyword: string; tags: string[] } {
  const tokens: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of query) {
    if (ch === '"') {
      inQuote = !inQuote;
      cur += ch;
      continue;
    }
    if (/\s/.test(ch) && !inQuote) {
      if (cur) tokens.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);

  const tags: string[] = [];
  const keyword: string[] = [];
  const strip = (v: string): string => {
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.endsWith('$')) v = v.slice(0, -1);
    return v;
  };
  for (const raw of tokens) {
    const excl = raw.startsWith('-');
    let body = excl ? raw.slice(1) : raw;
    const colon = body.indexOf(':');
    body = colon >= 0 ? `${body.slice(0, colon)}:${strip(body.slice(colon + 1))}` : strip(body);
    if (!body) continue;
    if (body.includes(':')) tags.push(`${excl ? '!' : ''}${body}`);
    else keyword.push(excl ? `-${body}` : body);
  }
  return { keyword: keyword.join(' '), tags };
}
