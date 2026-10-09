import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseExHentaiListing } from '../src/main/services/catalog-search';

const html = readFileSync(join('tests', 'fixtures', 'eh-popular.html'), 'utf-8');

describe('parseExHentaiListing /popular (thumbnail mode)', () => {
  it('parses a gallery from an e-hentai popular page', () => {
    const rows = parseExHentaiListing(html, 'https://e-hentai.org');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      url: 'https://e-hentai.org/g/3000/ghi789/',
      title: 'Popular Thumb Title',
      rating: 4.75,
    });
  });
});
