import { describe, expect, it } from 'vitest';
import { galleryKeyForUrl, seriesKeyForUrl, HistoryManager } from '../src/main/services/history';

describe('galleryKeyForUrl', () => {
  it('normalizes nhentai clearnet and onion to one key', () => {
    expect(galleryKeyForUrl('https://nhentai.net/g/681429/')).toBe(
      galleryKeyForUrl('http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion/g/681429/'),
    );
  });

  it('normalizes exhentai.org and the onion gateway to one key', () => {
    expect(galleryKeyForUrl('https://exhentai.org/g/3018651/813c8d5ae9/')).toBe(
      galleryKeyForUrl('http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion/g/3018651/813c8d5ae9/'),
    );
  });
});

describe('seriesKeyForUrl (MangaNet model: host-stable identity)', () => {
  it('senkuro.me and senkuro.com share one key', () => {
    expect(seriesKeyForUrl('https://senkuro.me/manga/foo/chapter/145161713279387187/'))
      .toBe(seriesKeyForUrl('https://senkuro.com/manga/foo/chapter/9/'))
      .toBe('sk:foo');
  });

  it('com-x reader ids collapse to the DLE news id', () => {
    expect(seriesKeyForUrl('https://com-x.life/reader/23831/147/')).toBe(seriesKeyForUrl('https://com-x.ru/reader/23831/88/'));
  });

  it('com-x catalog page and reader chapter of same manga match', () => {
    expect(seriesKeyForUrl('https://com-x.life/online/23831-some-slug.html/')).toBe(seriesKeyForUrl('https://com-x.life/reader/23831/9/'));
  });

  it('manga-shi / remanga / mangalib / grouple slugs are hostless keys', () => {
    expect(seriesKeyForUrl('https://manga-shi.org/manga/foo/tom-1/glava-1/')).toBe('ms:foo');
    expect(seriesKeyForUrl('https://api.remanga.org/manga/foo/3/')).toBe('rm:foo');
    expect(seriesKeyForUrl('https://mangalib.me/manga/foo')).toBe(seriesKeyForUrl('https://libmir.org/manga/foo/v1/c1'));
  });

  it('mangadex uuid and site url share the key, local folders collapse by path', () => {
    expect(seriesKeyForUrl('2a637f4b-56b1-4f8f-8c92-b925d97ab020'))
      .toBe(seriesKeyForUrl('https://api.mangadex.org/manga/2a637f4b-56b1-4f8f-8c92-b925d97ab020/feed'))
      .toBe('md:2a637f4b-56b1-4f8f-8c92-b925d97ab020');
    expect(seriesKeyForUrl('FILE://C:\\DIR\\MANGA-1')).toBe('local:file://c:\\dir\\manga-1');
  });

  it('chapter-based sources stay un-keyed when host unknown', () => {
    expect(seriesKeyForUrl('https://example.org/manga/foo/')).toBeNull();
  });

  it('keeps chapter-based sources un-keyed', () => {
    expect(galleryKeyForUrl('https://senkuro.me/manga/foo/chapter/1/')).toBeNull();
    expect(galleryKeyForUrl('file:///d:/manga/foo')).toBeNull();
  });
});

describe('HistoryManager keeps the furthest chapter (rewind guard)', () => {
  const base = { title: 't', cover_url: null, source: 'Senkuro', chapter_label: null, chapter_total: null, category: 'main', kind: null };
  const ch = (n: number, idx: number, url: string) => ({ ...base, url, series_id: 'sk:foo', chapter_index: idx, total_pages: 12 });

  it('opening an older chapter does not rewind the continue row', () => {
    const m = new HistoryManager();
    const c1 = 'https://senkuro.me/manga/foo/chapter/1/';
    const c10 = 'https://senkuro.me/manga/foo/chapter/10/';
    m.addOrUpdate(ch(1, 0, c1));
    m.addOrUpdate(ch(10, 9, c10));
    m.addOrUpdate(ch(1, 0, c1)); // accidentally re-opened the very first chapter
    const row = m.all()[0];
    expect(row.url).toBe(c10);
    expect(row.chapter_index).toBe(9);
  });

  it('moving forward still advances the row', () => {
    const m = new HistoryManager();
    const c1 = 'https://senkuro.me/manga/foo/chapter/1/';
    const c5 = 'https://senkuro.me/manga/foo/chapter/5/';
    m.addOrUpdate(ch(1, 0, c1));
    m.addOrUpdate(ch(5, 4, c5));
    expect(m.all()[0].url).toBe(c5);
  });
});

describe('HistoryManager merge by gallery key', () => {
  const base = {
    title: 't',
    cover_url: null,
    source: 'NHentai',
    chapter_label: null,
    chapter_index: null,
    chapter_total: null,
    category: 'r34',
  };

  it('updateProgress hits the entry opened under another host', () => {
    const m = new HistoryManager();
    m.load([
      { ...base, url: 'https://nhentai.net/g/42/', series_id: 'https://nhentai.net/g/42/', current_page: 3, total_pages: 10, opened_at: 1 },
    ]);
    m.updateProgress('http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion/g/42/', 7, 10);
    expect(m.all()).toHaveLength(1);
    expect(m.all()[0].current_page).toBe(7);
  });

  it('load collapses clearnet and onion records keeping the largest progress', () => {
    const m = new HistoryManager();
    m.load([
      {
        ...base,
        url: 'http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion/g/42/',
        series_id: 'http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion/g/42/',
        current_page: 2,
        total_pages: 10,
        opened_at: 2,
      },
      { ...base, url: 'https://nhentai.net/g/42/', series_id: 'https://nhentai.net/g/42/', current_page: 5, total_pages: 10, opened_at: 1 },
    ]);
    expect(m.all()).toHaveLength(1);
    expect(m.all()[0].current_page).toBe(5);
  });
});
