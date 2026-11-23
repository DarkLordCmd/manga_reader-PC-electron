import { describe, it, expect } from 'vitest';
import { mapRemangaBookmark } from '../src/main/services/remanga-import';
import { normalizeWorkTitle } from '../src/shared/work-title';

describe('Remanga bookmark mapping', () => {
  it('maps a nested bookmark with chapter progress', () => {
    const m = mapRemangaBookmark(
      {
        title: {
          dir: 'test-title',
          rus_name: 'Тестовое название',
          type: 2,
          count_chapters: 50,
          avg_rating: '8.6',
          cover: { high: '/media/titles/test/high.jpg' },
        },
        chapter: { chapter: '12', index: 11 },
      },
      0,
    )!;
    expect(m).toMatchObject({
      url: 'https://remanga.org/manga/test-title/',
      title: 'Тестовое название',
      source: 'Remanga',
      status: 'reading',
      kind: 'Манхва',
      chapterLabel: '12',
      chapterIndex: 11,
      chapterTotal: 50,
      adult: false,
    });
    expect(m.coverUrl).toBe('https://remanga.org/media/titles/test/high.jpg');
  });

  it('accepts flattened bookmarks and read_chapters count', () => {
    const m = mapRemangaBookmark(
      {
        dir: 'flat-title',
        main_name: 'Flat Title',
        chapter: '5',
        read_chapters: 5,
        is_forbidden: true,
        age_limit: 18,
        count_chapters: 90,
      },
      1,
    )!;
    expect(m.status).toBe('planned');
    expect(m.chapterIndex).toBe(4);
    expect(m.chapterLabel).toBe('5');
    expect(m.adult).toBe(true);
  });

  it('skips the not-interesting list and rows without a slug', () => {
    expect(mapRemangaBookmark({ dir: 'x' }, 5)).toBeNull();
    expect(mapRemangaBookmark({ title: { rus_name: 'No slug' } }, 0)).toBeNull();
  });
});

describe('normalizeWorkTitle', () => {
  it('matches the same work across sources', () => {
    expect(normalizeWorkTitle('Охотник SSS-уровня')).toBe(normalizeWorkTitle('Охотник SSS-уровня (Remake)'));
    expect(normalizeWorkTitle('[Senkuro] МобиДик — Том 1')).toBe('мобидик');
  });

  it('keeps different works apart', () => {
    expect(normalizeWorkTitle('Не друзья')).not.toBe(normalizeWorkTitle('Друзья'));
  });
});
