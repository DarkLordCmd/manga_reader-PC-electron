import { describe, it, expect } from 'vitest';
import { toStatusMap } from '../src/renderer/src/lib/status-map';
import type { LibraryItem } from '../src/shared/library';

const item = (over: Partial<LibraryItem>): LibraryItem =>
  ({
    key: 'k',
    seriesId: 'https://site/series/1',
    url: 'https://site/chapter/1',
    title: 'T',
    coverUrl: null,
    source: 'S',
    category: 'main',
    currentPage: 1,
    totalPages: 1,
    chapterLabel: null,
    chapterIndex: null,
    chapterTotal: null,
    status: null,
    note: '',
    rating: null,
    tags: [],
    openedAt: 0,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    favoritedAt: null,
    ...over,
  }) as LibraryItem;

describe('toStatusMap', () => {
  it('indexes chapter URL, series URL and key', () => {
    const map = toStatusMap([item({ status: 'reading' })]);
    expect(map['https://site/chapter/1']).toBe('reading');
    expect(map['https://site/series/1']).toBe('reading');
    expect(map['k']).toBe('reading');
  });
  it('omits works without a status', () => {
    expect(toStatusMap([item({ status: null })])).toEqual({});
  });
});
