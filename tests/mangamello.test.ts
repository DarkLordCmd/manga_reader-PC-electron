import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseMangaMelloSearch, parseMangaMelloChapter } from '../src/main/services/sources/mangamello';

const searchJson = readFileSync(join('tests', 'fixtures', 'mangamello-search.json'), 'utf-8');
const chapterJson = readFileSync(join('tests', 'fixtures', 'mangamello-chapter.json'), 'utf-8');

describe('mangamello parsers', () => {
  it('parses search results', () => {
    const r = parseMangaMelloSearch(searchJson, 'https://api.mangamello.com/v1/mangas/');
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('Gintama');
    expect(r[0].url).toContain('/manga/77/');
    expect(r[0].coverUrl).toContain('gintama.jpg');
    // `chapter` in the API is the last chapter NUMBER, not a page count: it must
    // land in chapterCount (the card renders `pages` as "N стр.").
    expect(r[0].chapterCount).toBe(612);
    expect(r[0].pages).toBeNull();
  });
  it('parses chapter pages', () => {
    const r = parseMangaMelloChapter(chapterJson);
    expect(r.title).toContain('Gintama');
    expect(r.pageUrls).toHaveLength(2);
  });
});
