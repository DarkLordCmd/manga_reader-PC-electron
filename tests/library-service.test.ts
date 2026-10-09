import { describe, it, expect } from 'vitest';
import { LibraryService } from '../src/main/services/library';
import { InMemorySeriesRepository } from '../src/main/services/series-repository';

function make(autoAdd = true): { svc: LibraryService; repo: InMemorySeriesRepository } {
  const repo = new InMemorySeriesRepository();
  return { svc: new LibraryService(repo, { autoAdd: () => autoAdd }), repo };
}

const seed = (repo: InMemorySeriesRepository, key = 'nh:1', url = 'https://nhentai.net/g/1/'): void => {
  repo.upsertHistory({
    key,
    seriesId: key,
    url,
    title: 'A',
    coverUrl: null,
    source: 'NHentai',
    category: 'r34',
    currentPage: 1,
    totalPages: 10,
    chapterLabel: null,
    chapterIndex: null,
    chapterTotal: null,
  });
};

describe('LibraryService', () => {
  it('auto-adds online rows as reading', () => {
    const { svc, repo } = make(true);
    seed(repo);
    svc.autoAddIfNeeded('https://nhentai.net/g/1/', 'nh:1');
    expect(repo.get('nh:1')!.status).toBe('reading');
  });

  it('does not auto-add local files', () => {
    const { svc, repo } = make(true);
    repo.upsertHistory({
      key: 'local:file://c:/x',
      seriesId: 'local:file://c:/x',
      url: 'file://C:/x',
      title: 'L',
      coverUrl: null,
      source: 'Локальная папка',
      category: 'main',
      currentPage: 1,
      totalPages: 3,
      chapterLabel: null,
      chapterIndex: null,
      chapterTotal: null,
    });
    svc.autoAddIfNeeded('file://C:/x', 'local:file://c:/x');
    expect(repo.get('local:file://c:/x')!.status).toBeNull();
  });

  it('does not auto-add when disabled or already in library', () => {
    const off = make(false);
    seed(off.repo);
    off.svc.autoAddIfNeeded('https://nhentai.net/g/1/', 'nh:1');
    expect(off.repo.get('nh:1')!.status).toBeNull();

    const on = make(true);
    seed(on.repo);
    on.repo.setStatus('nh:1', 'completed');
    on.svc.autoAddIfNeeded('https://nhentai.net/g/1/', 'nh:1');
    expect(on.repo.get('nh:1')!.status).toBe('completed');
  });

  it('addFromCatalog inserts as planned', () => {
    const { svc, repo } = make();
    const it = svc.addFromCatalog({
      url: 'https://manga-shi.org/manga/foo/tom-1/glava-1/',
      title: 'Foo',
      coverUrl: 'c',
      source: 'Manga-shi',
      seriesId: 'https://manga-shi.org/manga/foo/',
    });
    expect(it.status).toBe('planned');
    expect(repo.get('ms:foo')).not.toBeNull();
  });

  it('sets fields and removes from library', () => {
    const { svc, repo } = make();
    seed(repo);
    svc.setStatus('nh:1', 'reading');
    svc.setNote('nh:1', 'note');
    svc.setRating('nh:1', 8);
    svc.setTags('nh:1', ['a', 'b']);
    const it = repo.get('nh:1')!;
    expect([it.status, it.note, it.rating, it.tags]).toEqual(['reading', 'note', 8, ['a', 'b']]);
    svc.removeFromLibrary('nh:1');
    expect(repo.get('nh:1')!.status).toBeNull();
  });
});
