import { describe, it, expect } from 'vitest';
import { ehThumbnailPageUrl } from '../src/main/services/simple-gallery';

const HASH = '4e6f3ee6fd4ea261c11e11d6091b41a9a68503b6';
const BASE = 'https://e-hentai.org/g/3114482/05db553d1f/';

describe('ehThumbnailPageUrl (Multi-Page Viewer support)', () => {
  it('keeps ordinary /s/ links', () => {
    const href = '/s/4e6f3ee6fd/3114482-3';
    expect(ehThumbnailPageUrl({ href, base: BASE, hash: null, pageNumber: 3, galleryId: '3114482' })).toBe(
      'https://e-hentai.org/s/4e6f3ee6fd/3114482-3',
    );
  });

  it('rebuilds an MPV link from data-orghash and #pageN', () => {
    const href = 'https://e-hentai.org/mpv/3114482/05db553d1f/#page1';
    expect(ehThumbnailPageUrl({ href, base: BASE, hash: HASH, pageNumber: 7, galleryId: '3114482' })).toBe(
      'https://e-hentai.org/s/4e6f3ee6fd/3114482-1',
    );
  });

  it('falls back to the listing page number when the href has no #pageN', () => {
    const href = '/mpv/3114482/05db553d1f/';
    expect(ehThumbnailPageUrl({ href, base: BASE, hash: HASH, pageNumber: 21, galleryId: '3114482' })).toBe(
      'https://e-hentai.org/s/4e6f3ee6fd/3114482-21',
    );
  });

  it('refuses MPV links without the image hash (datatags cookie missing)', () => {
    const href = '/mpv/3114482/05db553d1f/#page1';
    expect(ehThumbnailPageUrl({ href, base: BASE, hash: null, pageNumber: 1, galleryId: '3114482' })).toBeNull();
  });

  it('ignores MPV links that belong to another gallery (related widgets)', () => {
    const href = '/mpv/999999/abcdef/#page1';
    expect(ehThumbnailPageUrl({ href, base: BASE, hash: HASH, pageNumber: 1, galleryId: '3114482' })).toBeNull();
  });

  it('returns null for unrelated links', () => {
    expect(ehThumbnailPageUrl({ href: '/favorites.php', base: BASE, hash: HASH, pageNumber: 1, galleryId: '3114482' })).toBeNull();
  });
});
