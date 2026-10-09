import { describe, it, expect } from 'vitest';
import { LibraryService } from '../src/main/services/library';
import { InMemorySeriesRepository } from '../src/main/services/series-repository';
import { categoryForUrl } from '../src/main/services/series-key';

function make() {
  const repo = new InMemorySeriesRepository();
  return { svc: new LibraryService(repo, { autoAdd: () => false }), repo };
}

describe('LibraryService favorites', () => {
  it('addFavorite upserts and marks, without status', () => {
    const { svc, repo } = make();
    const it = svc.addFavorite({
      url: 'https://nhentai.net/g/5/',
      title: 'F',
      coverUrl: null,
      source: 'NHentai',
      seriesId: 'https://nhentai.net/g/5/',
    });
    expect(it.favoritedAt).not.toBeNull();
    expect(it.status).toBeNull();
    expect(repo.list({ scope: 'favorites' })).toHaveLength(1);
  });

  it('setFavorite toggles, lookup reflects state', () => {
    const { svc } = make();
    svc.addFavorite({ url: 'https://nhentai.net/g/5/', title: 'F', coverUrl: null, source: 'NHentai', seriesId: 'x' });
    expect(svc.lookup('https://nhentai.net/g/5/', 'x')!.favorited).toBe(true);
    svc.setFavorite('nh:5', null);
    expect(svc.lookup('https://nhentai.net/g/5/', 'x')?.favorited).toBe(false);
  });

  it('setStatusFor upserts and sets status independently of favorite', () => {
    const { svc, repo } = make();
    const it = svc.setStatusFor(
      { url: 'https://nhentai.net/g/5/', title: 'F', coverUrl: null, source: 'NHentai', seriesId: 'x' },
      'completed',
    );
    expect(it.status).toBe('completed');
    expect(it.favoritedAt).toBeNull();
    expect(repo.list({ scope: 'library' }).map((i) => i.key)).toEqual(['nh:5']);
  });

  it('countFavorites', () => {
    const { svc } = make();
    svc.addFavorite({ url: 'https://nhentai.net/g/5/', title: 'F', coverUrl: null, source: 'NHentai', seriesId: 'x' });
    svc.addFavorite({ url: 'https://nhentai.net/g/6/', title: 'G', coverUrl: null, source: 'NHentai', seriesId: 'y' });
    expect(svc.countFavorites()).toBe(2);
  });

  it('classifies E-Hentai/nhentai catalog adds as r34, not main', () => {
    const { svc, repo } = make();
    svc.setStatusFor(
      {
        url: 'http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion/g/123/abc/',
        title: 'X',
        coverUrl: null,
        source: 'ExHentai',
        seriesId: 'x',
      },
      'planned',
    );
    expect(repo.list({ scope: 'library', category: 'r34' })).toHaveLength(1);
    expect(repo.list({ scope: 'library', category: 'main' })).toHaveLength(0);
  });
});

describe('categoryForUrl', () => {
  it('maps E-Hentai family and nhentai to r34', () => {
    expect(categoryForUrl('http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion/g/1/')).toBe('r34');
    expect(categoryForUrl('https://e-hentai.org/g/1/')).toBe('r34');
    expect(categoryForUrl('https://nhentai.net/g/1/')).toBe('r34');
    expect(categoryForUrl('https://mangadex.org/title/abc')).toBe('main');
  });
});
