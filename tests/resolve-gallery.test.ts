import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/main/services/mangadex', () => ({
  resolveAtHome: async () => ({ baseUrl: 'https://x', hash: 'h', files: ['1.jpg', '2.jpg'] }),
}));
vi.mock('../src/main/services/simple-gallery', () => ({
  fetchSimpleGallery: async () => ({ title: 'T', pageUrls: ['p1'], coverUrl: 'c', sourcePages: [null] }),
}));

import { resolveGallery, extractMangaDexChapterId } from '../src/main/services/resolve-gallery';

describe('resolveGallery', () => {
  beforeEach(() => vi.clearAllMocks());
  it('routes mangadex chapter urls', async () => {
    const r = await resolveGallery('https://mangadex.org/chapter/abc-def-0000-0000-000000000000', {});
    expect(r.source).toBe('MangaDex');
    expect(r.pageUrls).toHaveLength(2);
    expect(r.pageUrls[0]).toBe('https://x/data/h/1.jpg');
  });
  it('routes nhentai to simple gallery', async () => {
    const r = await resolveGallery('https://nhentai.net/g/123/', {});
    expect(r.source).toBe('NHentai');
    expect(r.pageUrls).toEqual(['p1']);
  });
  it('extracts mangadex chapter id from uuid', () => {
    expect(extractMangaDexChapterId('b6f8a2b1-1a2b-3c4d-5e6f-7a8b9c0d1e2f')).not.toBeNull();
  });
});
