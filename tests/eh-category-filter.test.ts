import { describe, it, expect } from 'vitest';
import { ehExcludedKinds, filterCardsByEhKinds } from '../src/shared/filters';

const cards = [
  { kind: 'Doujinshi', url: '1' },
  { kind: 'Manga', url: '2' },
  { kind: 'Cosplay', url: '3' },
  { kind: 'Misc', url: '4' },
  { kind: null, url: '5' },
  { url: '6' },
];

describe('ehExcludedKinds', () => {
  it('is empty for the default mask', () => {
    expect([...ehExcludedKinds(0)]).toEqual([]);
  });

  it('maps the f_cats bits to category labels', () => {
    expect([...ehExcludedKinds(2)]).toEqual(['doujinshi']);
    expect([...ehExcludedKinds(6)].sort()).toEqual(['doujinshi', 'manga']);
    expect([...ehExcludedKinds(70)].sort()).toEqual(['cosplay', 'doujinshi', 'manga']);
    expect([...ehExcludedKinds(8)]).toEqual(['artist cg']);
  });
});

describe('filterCardsByEhKinds', () => {
  it('returns everything when nothing is excluded', () => {
    expect(filterCardsByEhKinds(cards, 0)).toHaveLength(cards.length);
  });

  it('hides the excluded categories instantly', () => {
    const shown = filterCardsByEhKinds(cards, 6).map((c) => c.url);
    expect(shown).toEqual(['3', '4', '5', '6']);
  });

  it('keeps cards without a known category and only shows categories not excluded', () => {
    const shown = filterCardsByEhKinds(cards, 1022).map((c) => c.url);
    expect(shown).toEqual(['4', '5', '6']); // Misc is not in the mask
  });

  it('is case-insensitive', () => {
    expect(filterCardsByEhKinds([{ kind: 'COSPLAY', url: 'x' }], 64)).toHaveLength(0);
  });
});
