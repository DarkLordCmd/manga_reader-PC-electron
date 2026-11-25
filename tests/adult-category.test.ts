import { describe, it, expect } from 'vitest';
import { categoryForUrl } from '../src/main/services/series-key';
import { LibraryService } from '../src/main/services/library';
import { InMemorySeriesRepository } from '../src/main/services/series-repository';

describe('categoryForUrl', () => {
  it('keeps R34 sources in the R34 tab', () => {
    expect(categoryForUrl('https://exhentai.org/g/1/abc/')).toBe('r34');
    expect(categoryForUrl('https://nhentai.net/g/1/')).toBe('r34');
  });

  it('keeps ordinary sources in main', () => {
    expect(categoryForUrl('https://manga-shi.org/manga/x/')).toBe('main');
  });
});

describe('18+ works from non-R34 sources', () => {
  it('land in the R34 tab by the adult flag', () => {
    expect(categoryForUrl('https://manga-shi.org/manga/x/', true)).toBe('r34');
  });

  it('library entry with adult=true is stored as r34', () => {
    const repo = new InMemorySeriesRepository();
    const svc = new LibraryService(repo, { autoAdd: () => true });
    const item = svc.addFromCatalog({
      url: 'https://manga-shi.org/manga/mihi/',
      title: 'Михи',
      coverUrl: null,
      source: 'Manga-shi',
      seriesId: 'https://manga-shi.org/manga/mihi/',
      adult: true,
    });
    expect(item.category).toBe('r34');
  });

  it('keeps Mangalib in Main and repairs legacy R34 rows', () => {
    const repo = new InMemorySeriesRepository();
    const svc = new LibraryService(repo, { autoAdd: () => true });
    const item = svc.addFromCatalog({
      url: 'https://mangalib.me/7580--berserk',
      title: 'Берсерк',
      coverUrl: null,
      source: 'Mangalib',
      seriesId: 'https://mangalib.me/7580--berserk',
      adult: true,
    });
    expect(item.category).toBe('main');

    repo.upsertHistory({
      key: 'ml:7580--berserk',
      seriesId: 'https://mangalib.me/7580--berserk',
      url: 'https://mangalib.me/7580--berserk',
      title: 'Берсерк',
      coverUrl: null,
      source: 'Mangalib',
      category: 'r34',
      kind: null,
      currentPage: 1,
      totalPages: 0,
      chapterLabel: null,
      chapterIndex: null,
      chapterTotal: null,
      openedAt: Date.now(),
      createdAt: Date.now(),
    });
    expect(svc.repairMangalibMainCategories()).toBeGreaterThan(0);
    expect(repo.get('ml:7580--berserk')?.category).toBe('main');

    const hentai = svc.addFromCatalog({
      url: 'https://hentailib.me/ru/manga/7580--berserk',
      title: 'Берсерк',
      coverUrl: null,
      source: 'HentaiLIB',
      seriesId: 'https://hentailib.me/ru/manga/7580--berserk',
      adult: true,
    });
    expect(hentai.category).toBe('r34');
  });

  it('library entry without adult stays main', () => {
    const repo = new InMemorySeriesRepository();
    const svc = new LibraryService(repo, { autoAdd: () => true });
    const item = svc.addFromCatalog({
      url: 'https://manga-shi.org/manga/anderbokser/',
      title: 'Андербоксер',
      coverUrl: null,
      source: 'Manga-shi',
      seriesId: 'https://manga-shi.org/manga/anderbokser/',
    });
    expect(item.category).toBe('main');
  });
});
