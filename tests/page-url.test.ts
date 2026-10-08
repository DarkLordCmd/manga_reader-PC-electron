import { describe, it, expect } from 'vitest';
import { parseMangaPageUrl } from '../src/main/services/page-url';

describe('parseMangaPageUrl', () => {
  it('parses the renderer manga://page/<gid>/<index> format', () => {
    expect(parseMangaPageUrl('manga://page/123e4567-e89b-12d3-a456-426614174000/5')).toEqual({
      gid: '123e4567-e89b-12d3-a456-426614174000',
      index: 5,
    });
  });

  it('parses the legacy manga://<gid>/<index> format', () => {
    expect(parseMangaPageUrl('manga://abc-123/2')).toEqual({ gid: 'abc-123', index: 2 });
  });

  it('returns null for cover URLs and garbage', () => {
    expect(parseMangaPageUrl('manga://cover/https%3A%2F%2Fexample.com')).toBeNull();
    expect(parseMangaPageUrl('not a url')).toBeNull();
  });
});
