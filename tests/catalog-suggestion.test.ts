import { describe, expect, it } from 'vitest';
import { catalogCardFromSuggestion } from '../src/renderer/src/screens/catalog/catalog-suggestion';
import type { SearchSuggestion } from '../src/shared/ipc';

const suggestion: SearchSuggestion = {
  kind: 'work',
  title: 'Title',
  url: 'https://hentailib.me/ru/manga/60127--example',
  coverUrl: 'https://img.example/cover.jpg',
  status: 'Онгоинг',
  age18: true,
};

describe('catalog suggestion cards', () => {
  it('preserves adult and age flags when opening an autocomplete result', () => {
    expect(catalogCardFromSuggestion(suggestion, 'hentailib')).toEqual({
      url: suggestion.url,
      title: suggestion.title,
      coverUrl: suggestion.coverUrl,
      pages: null,
      status: suggestion.status,
      tags: [],
      adult: true,
      age18: true,
    });
  });

  it('recognizes HentaiLIB by URL even if a suggestion omits its age flag', () => {
    expect(catalogCardFromSuggestion({ ...suggestion, age18: undefined }, 'hentailib').adult).toBe(true);
  });

  it('does not mark regular Mangalib suggestions as adult', () => {
    const card = catalogCardFromSuggestion(
      { ...suggestion, url: 'https://mangalib.me/60127--example', age18: false },
      'mangalib',
    );
    expect(card.adult).toBeUndefined();
    expect(card.age18).toBe(false);
  });
});
