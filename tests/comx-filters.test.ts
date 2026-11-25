import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ comxFetchText: vi.fn() }));
vi.mock('../src/main/services/comx-gate', () => ({
  comxFetchText: mocks.comxFetchText,
  cookieForHost: () => '',
}));
vi.mock('../src/main/services/browser-fetch', () => ({ fetchHtmlViaBrowser: vi.fn() }));

import { searchComx } from '../src/main/services/sources/comx';

describe('Com-X catalogue filters', () => {
  beforeEach(() => {
    mocks.comxFetchText.mockReset();
    mocks.comxFetchText.mockResolvedValue('<html><body></body></html>');
  });

  it('builds the site xfilter URL with list/range/exclusion params', async () => {
    await searchComx({} as any, '', 0, {
      category: '44',
      genres: ['29', '55'],
      excludeGenres: ['64'],
      types: ['3'],
      statuses: ['2'],
      ages: ['5'],
      yearFrom: '2020',
      yearTo: '2025',
    });

    expect(mocks.comxFetchText).toHaveBeenCalledWith(
      'https://com-x.life/ComicList/p.cat=44/g=29,55/exc_g=64/t=3/st=2/adult=5/y[from]=2020/y[to]=2025/',
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
  });

  it('keeps the unfiltered catalogue URL when no filters are selected', async () => {
    await searchComx({} as any, '', 0, {});
    expect(mocks.comxFetchText.mock.calls[0][0]).toBe('https://com-x.life/comix-read/');
  });

  it('keeps filters on follow-up pages', async () => {
    await searchComx({} as any, '', 1, { category: '44', genres: ['29'], excludeGenres: ['64'] });
    expect(mocks.comxFetchText.mock.calls[0][0]).toBe(
      'https://com-x.life/ComicList/p.cat=44/g=29/exc_g=64/page/2/',
    );
  });

  it('treats a filtered 404 past the last page as an empty result', async () => {
    mocks.comxFetchText.mockRejectedValueOnce(new Error('HTTP 404 for https://com-x.life/ComicList/p.cat=44/page/2/'));
    await expect(searchComx({} as any, '', 1, { category: '44' })).resolves.toEqual([]);
  });

  it('treats a zero-match first page as an empty result', async () => {
    mocks.comxFetchText.mockRejectedValueOnce(new Error('HTTP 404 for https://com-x.life/ComicList/g=29/t=3/'));
    await expect(searchComx({} as any, '', 0, { genres: ['29'], types: ['3'] })).resolves.toEqual([]);
  });
});
