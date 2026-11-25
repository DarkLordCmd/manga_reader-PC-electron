import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchHtmlSmart: vi.fn(),
  httpFetch: vi.fn(),
  httpGetJson: vi.fn(),
}));

vi.mock('../src/main/services/fetch-html', () => ({ fetchHtmlSmart: mocks.fetchHtmlSmart }));
vi.mock('../src/main/services/http', () => ({
  httpFetch: mocks.httpFetch,
  httpGetJson: mocks.httpGetJson,
}));

import { fetchMangaShiChapters, searchMangaShi, setMangaShiCookies } from '../src/main/services/sources/mangashi';
import { mangalibChapterUrl } from '../src/main/services/sources/mangalib';
import { resetMangalibJar, searchMangalib, setMangalibUserCookies } from '../src/main/services/sources/mangalib';
import { fetchRemangaChapters } from '../src/main/services/sources/remanga';

const PROXY = 'socks5h://127.0.0.1:9050';
const OTHER_PROXY = 'socks5h://127.0.0.1:9150';
const MANGA_URL = 'https://remanga.org/manga/berserk/';

const apiManga = {
  name: 'Berserk',
  rus_name: 'Берсерк',
  eng_name: 'Berserk',
  slug_url: '7580--berserk',
  cover: { default: 'https://img.example/berserk.jpg' },
  chap_count: '10',
  rate_avg: 9.2,
  type: { label: 'Манга' },
};

function mockMangalibApi(data: unknown[]): void {
  mocks.httpFetch.mockImplementation(async (opts: { url: string }) => {
    if (opts.url === 'https://mangalib.me/') {
      return { status: 200, text: '<html></html>', setCookies: ['__ddg1=primed; Path=/; HttpOnly'] };
    }
    return { status: 200, text: JSON.stringify({ data }), setCookies: [] };
  });
}

function mockRemangaChapterPages(lastPage: number): void {
  mocks.httpGetJson.mockImplementation(async (url: string) => {
    if (url === 'https://remanga.org/api/v2/titles/berserk/') {
      return { main_name: 'Берсерк', branches: [{ id: 42 }] };
    }
    const page = Number(new URL(url).searchParams.get('page'));
    if (page > lastPage) return { results: [] };
    return {
      results: [{ id: page, index: page, chapter: String(page), name: null }],
      next: page < lastPage ? page + 1 : null,
    };
  });
}

function remangaChapterCalls(): string[] {
  return mocks.httpGetJson.mock.calls.map((call) => call[0] as string).filter((url) => url.includes('/titles/chapters/'));
}

beforeEach(() => {
  vi.resetAllMocks();
  resetMangalibJar();
  setMangaShiCookies('');
  setMangalibUserCookies('');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Manga-shi catalog pagination', () => {
  it('treats a follow-up HTTP 200 page without media-shell as end-of-pagination', async () => {
    mocks.fetchHtmlSmart.mockResolvedValue('<html><body>No results</body></html>');

    await expect(searchMangaShi('', undefined, {}, 1)).resolves.toEqual([]);
  });

  it('keeps treating a follow-up HTTP 404 as end-of-pagination', async () => {
    mocks.fetchHtmlSmart.mockRejectedValue(new Error('HTTP 404 for https://manga-shi.org/catalog/?page=2'));

    await expect(searchMangaShi('', undefined, {}, 1)).resolves.toEqual([]);
  });

  it('passes Manga-shi list, exclusion, year and bookmark filters to the site', async () => {
    mocks.fetchHtmlSmart.mockResolvedValue('<html><body>No results</body></html>');
    setMangaShiCookies('manga_session=abc');

    await searchMangaShi(
      '',
      undefined,
      {
        mangashiPreset: 'popular',
        mangashiYear: '2024',
        mangashiTags: ['tag-a'],
        mangashiExcludeTags: ['tag-b'],
        mangashiBookmarkStatuses: ['READING', 'COMPLETED'],
        mangashiHideBookmarked: true,
      },
      1,
    );

    const url = mocks.fetchHtmlSmart.mock.calls[0][0] as string;
    expect(url).toContain('preset=popular');
    expect(url).toContain('year=2024');
    expect(url).toContain('tag=tag-a');
    expect(url).toContain('exclude_tag=tag-b');
    expect(url).toContain('bookmark_status=READING');
    expect(url).toContain('bookmark_status=COMPLETED');
    expect(url).toContain('hide_bookmarked=1');
    expect(mocks.fetchHtmlSmart.mock.calls[0][1]).toMatchObject({ cookieHeader: 'manga_session=abc' });
  });
  it('still reports a missing media-shell as a layout change on page zero', async () => {
    mocks.fetchHtmlSmart.mockResolvedValue('<html><body>No results</body></html>');

    await expect(searchMangaShi('', undefined, {}, 0)).rejects.toMatchObject({
      code: 'layout-changed',
      sourceName: 'Manga-shi',
    });
  });
});

describe('Manga-shi chapter pagination', () => {
  it('treats a follow-up HTTP 404 as the end of the chapter list', async () => {
    mocks.fetchHtmlSmart
      .mockResolvedValueOnce('<a href="/manga/x/glava-1/">Глава 1</a><link rel="next" href="?page=2">')
      .mockRejectedValueOnce(new Error('HTTP 404 for https://manga-shi.org/manga/x/chapters/?page=2'));

    await expect(fetchMangaShiChapters('https://manga-shi.org/manga/x/')).resolves.toEqual([
      { chapter_id: 'https://manga-shi.org/manga/x/glava-1/', chapter_num: 'Глава 1', title: null, lang: 'mangashi' },
    ]);
  });
});

describe('Mangalib catalog pagination', () => {
  it('primes a cold cookie jar through the same proxy as the API call', async () => {
    mockMangalibApi([apiManga]);

    const result = await searchMangalib('berserk', 0, PROXY);

    expect(result).toHaveLength(1);
    expect(mocks.httpFetch).toHaveBeenCalledTimes(2);
    expect(mocks.httpFetch.mock.calls[0][1]).toBe(PROXY);
    expect(mocks.httpFetch.mock.calls[1][1]).toBe(PROXY);
  });

  it('primes an expired cookie jar through the current API proxy', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    mockMangalibApi([apiManga]);

    await searchMangalib('berserk', 0, PROXY);
    vi.setSystemTime(new Date('2026-01-01T00:30:01Z'));
    await searchMangalib('berserk', 0, OTHER_PROXY);

    expect(mocks.httpFetch).toHaveBeenCalledTimes(4);
    expect(mocks.httpFetch.mock.calls[2][1]).toBe(OTHER_PROXY);
    expect(mocks.httpFetch.mock.calls[3][1]).toBe(OTHER_PROXY);
  });

  it('returns an empty list for empty API data on a follow-up page', async () => {
    mockMangalibApi([]);

    await expect(searchMangalib('', 1, PROXY)).resolves.toEqual([]);
  });

  it('loads HentaiLIB as lib.social site 2 with adult URLs', async () => {
    mockMangalibApi([apiManga]);

    const result = await searchMangalib('', 0, PROXY, {}, 2);

    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe('https://hentailib.me/ru/manga/7580--berserk');
    expect(result[0]?.adult).toBe(true);
    expect(result[0]?.age18).toBe(true);
    const url = new URL(mocks.httpFetch.mock.calls[1][0].url);
    expect(url.searchParams.get('site_id[]')).toBe('2');
    expect(mangalibChapterUrl('7580--berserk', { id: 1, volume: '1', number: '1', numberSecondary: null, name: '' }, 2)).toBe(
      'https://hentailib.me/ru/manga/7580--berserk/read/v1/c1',
    );
  });
  it('filters Mangalib age restrictions locally when the API ignores caution', async () => {
    mockMangalibApi([
      { ...apiManga, slug_url: '1--adult', rus_name: 'Adult', ageRestriction: { id: 4, label: '18+' } },
      { ...apiManga, slug_url: '2--teen', rus_name: 'Teen', ageRestriction: { id: 3, label: '16+' } },
    ]);

    const result = await searchMangalib('', 0, PROXY, { mangalibAgeRatings: ['4'] });

    expect(result.map((x) => x.title)).toEqual(['Adult']);
    expect(result[0]?.age18).toBe(true);
  });
  it('passes Mangalib filters to the lib.social API', async () => {
    mockMangalibApi([apiManga]);

    await searchMangalib('berserk', 0, PROXY, {
      mangalibTypes: ['5'],
      mangalibStatuses: ['2'],
      mangalibFormats: ['1'],
      mangalibAgeRatings: ['4'],
      mangalibGenres: ['34'],
      mangalibTags: ['271'],
      mangalibCountries: ['JP'],
      mangalibBookmarks: ['1'],
      mangalibChaptersMin: '100',
      mangalibChaptersMax: '500',
      mangalibRatingMin: '8',
      mangalibRatingMax: '10',
      mangalibVotesMin: '1000',
      mangalibVotesMax: '90000',
      mangalibYearMin: '2020',
      mangalibYearMax: '2025',
      mangalibSortBy: 'rate_avg',
      mangalibOrder: 'desc',
    });

    const url = new URL(mocks.httpFetch.mock.calls[1][0].url);
    for (const [key, value] of [
      ['types[]', '5'],
      ['status[]', '2'],
      ['format[]', '1'],
      ['caution[]', '4'],
      ['genres[]', '34'],
      ['tags[]', '271'],
      ['country[]', 'JP'],
      ['bookmarks[]', '1'],
      ['chap_count_min', '100'],
      ['chap_count_max', '500'],
      ['rating_min', '8'],
      ['rating_max', '10'],
      ['rate_min', '1000'],
      ['rate_max', '90000'],
      ['year_min', '2020'],
      ['year_max', '2025'],
      ['sort_by', 'rate_avg'],
      ['order', 'desc'],
    ]) {
      expect(url.searchParams.get(key)).toBe(value);
    }
  });
  it('does not mistake malformed follow-up entries for an empty page', async () => {
    mockMangalibApi([{ name: 'Missing slug' }]);

    await expect(searchMangalib('', 1, PROXY)).rejects.toThrow('Mangalib: пустой каталог');
  });

  it('keeps the no-results error for empty API data on page zero', async () => {
    mockMangalibApi([]);

    await expect(searchMangalib('', 0, PROXY)).rejects.toThrow('Mangalib: пустой каталог');
  });
});

describe('Remanga chapter pagination', () => {
  it('continues past 51 nonempty pages instead of silently truncating', async () => {
    mockRemangaChapterPages(52);

    const chapters = await fetchRemangaChapters(MANGA_URL, PROXY);

    expect(chapters).toHaveLength(52);
    expect(chapters.at(-1)).toMatchObject({
      chapter_id: 'https://remanga.org/manga/berserk/52/',
      chapter_num: '52',
    });
  });

  it('raises an explicit truncation error at a bounded hard cap', async () => {
    mockRemangaChapterPages(1000);

    await expect(fetchRemangaChapters(MANGA_URL, PROXY)).rejects.toThrow('Remanga: превышен лимит пагинации глав');
    expect(remangaChapterCalls().length).toBeGreaterThan(51);
    expect(remangaChapterCalls().length).toBeLessThan(1000);
  });
});
