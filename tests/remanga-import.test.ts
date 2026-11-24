import { describe, it, expect } from 'vitest';
import { mapRemangaBookmark, remangaAuthFromCookies } from '../src/main/services/remanga-import';
import { normalizeWorkTitle, chapterLabelNumber } from '../src/shared/work-title';
import { hasAuthenticatedSession } from '../src/main/services/login';

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
      2,
    )!;
    expect(m.status).toBe('planned');
    expect(m.chapterIndex).toBe(4);
    expect(m.chapterLabel).toBe('5');
    expect(m.adult).toBe(true);
  });

  it('reads v2 read_progress/read_progress_total', () => {
    const m = mapRemangaBookmark(
      {
        read_progress: 53,
        read_progress_total: 180,
        title: { dir: 'v2-title', rus_name: 'V2 Title', count_chapters: 180 },
      },
      0,
    )!;
    expect(m.chapterIndex).toBe(52);
    expect(m.chapterLabel).toBe('53');
    expect(m.chapterTotal).toBe(180);
  });

  it('skips the not-interesting list and rows without a slug', () => {
    expect(mapRemangaBookmark({ dir: 'x' }, 6)).toBeNull();
    expect(mapRemangaBookmark({ title: { rus_name: 'No slug' } }, 0)).toBeNull();
  });
});

describe('Remanga bookmark list types', () => {
  it('maps statuses from user_bookmarks types (1/3/5/7)', () => {
    expect(mapRemangaBookmark({ title: { dir: 'a', rus_name: 'A' } }, 1)!.status).toBe('reading');
    expect(mapRemangaBookmark({ title: { dir: 'b', rus_name: 'B' } }, 3)!.status).toBe('completed');
    expect(mapRemangaBookmark({ title: { dir: 'c', rus_name: 'C' } }, 5)!.status).toBe('on_hold');
    const fav = mapRemangaBookmark({ title: { dir: 'd', rus_name: 'D' } }, 7)!;
    expect(fav.favorite).toBe(true);
    expect(fav.status).toBeNull();
    expect(mapRemangaBookmark({ title: { dir: 'e', rus_name: 'E' } }, 6)).toBeNull();
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

describe('Remanga browser login helpers', () => {
  it('extracts the synthetic token cookie and keeps the session cookies', () => {
    const a = remangaAuthFromCookies('sessionid=abc; mr_rm_token=tok%2Fen; __ddg1_=x');
    expect(a.token).toBe('tok/en');
    expect(a.cookies).toBe('sessionid=abc; __ddg1_=x');
  });

  it('recognises a logged-in Remanga window', () => {
    expect(hasAuthenticatedSession('https://remanga.org/', [{ name: 'sessionid', value: 'x' }], false)).toBe(true);
    expect(hasAuthenticatedSession('https://remanga.org/', [{ name: 'mr_rm_token', value: 'x' }], false)).toBe(true);
    expect(hasAuthenticatedSession('https://remanga.org/', [], false)).toBe(false);
  });
});
describe('chapter label display', () => {
  it('strips volume prefixes used by the reader', () => {
    expect(chapterLabelNumber('1 / 148')).toBe('148');
    expect(chapterLabelNumber('Том 1 Глава 2')).toBe('2');
    expect(chapterLabelNumber('12.5')).toBe('12.5');
    expect(chapterLabelNumber('')).toBeNull();
  });
});