import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/main/services/http', () => ({
  httpFetch: vi.fn(async () => ({ status: 200, text: '<html>nothing here</html>' })),
  httpGetJson: vi.fn(),
  httpPostJson: vi.fn(),
}));

import { searchSimpleSite } from '../src/main/services/sources/simple-sites';
import { searchMangaShi, fetchMangaShiChapters } from '../src/main/services/sources/mangashi';
import { searchNhentai } from '../src/main/services/sources/nhentai';
import { parseExHentaiListing } from '../src/main/services/sources/eh';

describe('layout-watchdog integration (junk markup)', () => {
  it('searchSimpleSite rejects with layout-changed', async () => {
    await expect(
      searchSimpleSite(
        {
          name: 'TestSite',
          base: 'https://example.com',
          catalogPath: '/',
          searchPath: '/search?q=',
          linkMarker: '/manga/',
        },
        'x',
      ),
    ).rejects.toMatchObject({ code: 'layout-changed', sourceName: 'TestSite' });
  });

  it('searchMangaShi rejects with layout-changed', async () => {
    await expect(searchMangaShi('q')).rejects.toMatchObject({ code: 'layout-changed', sourceName: 'Manga-shi' });
  });

  it('fetchMangaShiChapters rejects with layout-changed', async () => {
    await expect(fetchMangaShiChapters('https://manga-shi.org/berserk/')).rejects.toMatchObject({
      code: 'layout-changed',
      sourceName: 'Manga-shi chapters',
    });
  });

  it('searchNhentai rejects with layout-changed', async () => {
    await expect(searchNhentai('https://example.com', 'q', 0)).rejects.toMatchObject({ code: 'layout-changed', sourceName: 'NHentai' });
  });

  it('parseExHentaiListing rejects with layout-changed', () => {
    expect(() => parseExHentaiListing('<html>nothing here</html>', 'https://exhentai.org')).toThrow(
      expect.objectContaining({ code: 'layout-changed', sourceName: 'E-Hentai list' }),
    );
  });
});
