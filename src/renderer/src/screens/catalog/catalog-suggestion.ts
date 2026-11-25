import type { CatalogCard, SearchSuggestion } from '@shared/ipc';

export function catalogCardFromSuggestion(suggestion: SearchSuggestion, source: string): CatalogCard {
  const url = suggestion.url ?? '';
  const hentailib = source === 'hentailib' || /hentailib\./i.test(url);
  const age18 = suggestion.age18 === true || hentailib ? true : suggestion.age18;
  return {
    url,
    title: suggestion.title,
    coverUrl: suggestion.coverUrl ?? null,
    pages: null,
    status: suggestion.status ?? null,
    tags: [],
    age18,
    // Every current producer uses age18=true for adult/R34 works (HentaiLIB,
    // NHentai, ReManga forbidden titles, Senkuro EXPLICIT, resolved Manga-shi).
    adult: age18 === true ? true : undefined,
  };
}
