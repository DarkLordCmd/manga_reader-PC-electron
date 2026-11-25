import { describe, it, expect } from 'vitest';
import { isSafeRemoteUrl } from '../src/main/services/url-guard';
import { parseMangaPageUrl } from '../src/main/services/page-url';
import { moveQuickSearchInView, type QuickSearch } from '../src/shared/quick-search';
import { parseChapterFeed } from '../src/main/services/mangadex';
import { mangalibChapterUrl } from '../src/main/services/sources/mangalib';
import { senkuroMangaSlugFromUrl, senkuroSeriesUrlFromChapterUrl } from '../src/main/services/sources/senkuro';
import { parseExitFingerprints } from '../src/main/services/tor-embedded';
import { parseEhBanSeconds } from '../src/main/services/sources/eh';

describe('url-guard (SSRF hardening)', () => {
  it('rejects loopback/LAN/metadata targets', () => {
    for (const u of [
      'http://127.0.0.1/x.png',
      'http://localhost/x.png',
      'http://localhost./x.png',
      'https://10.0.0.5/x',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/x',
      'http://[::ffff:127.0.0.1]/x',
      'http://0.0.0.0/x',
      'http://router.local/x',
      'http://svc.internal/x',
      'file:///etc/passwd',
    ]) {
      expect(isSafeRemoteUrl(u), u).toBe(false);
    }
  });

  it('allows public http(s) hosts and onion mirrors', () => {
    expect(isSafeRemoteUrl('https://e-hentai.org/g/1/abc/')).toBe(true);
    expect(isSafeRemoteUrl('http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion/s/1-2')).toBe(true);
  });
});

describe('parseMangaPageUrl', () => {
  it('marks thumbnail requests so they never outrank a reader page', () => {
    const base = parseMangaPageUrl('manga://page/g1/7');
    expect(base).toEqual({ gid: 'g1', index: 7 });
    expect(parseMangaPageUrl('manga://page/g1/7?thumb=1')).toEqual({ gid: 'g1', index: 7, thumb: true });
    expect(parseMangaPageUrl('manga://page/g1/7?thumb=1&r=2')?.thumb).toBe(true);
  });
});

describe('moveQuickSearchInView', () => {
  const q = (id: string): QuickSearch => ({ id, name: id, source: 'exhentai', query: '' });
  it('skips hidden neighbours instead of reordering the invisible tail', () => {
    const list = [q('a'), q('hidden'), q('b')];
    const hidden = (x: QuickSearch): boolean => x.id === 'hidden';
    // "a" down and "b" up both cross the hidden entry and end up as [b, hidden, a].
    expect(moveQuickSearchInView(list, 'a', 'down', hidden).map((x) => x.id)).toEqual(['b', 'hidden', 'a']);
    expect(moveQuickSearchInView(list, 'b', 'up', hidden).map((x) => x.id)).toEqual(['b', 'hidden', 'a']);
  });

  it('does nothing at the edge of the visible list', () => {
    const list = [q('a'), q('hidden')];
    expect(moveQuickSearchInView(list, 'a', 'down', (x) => x.id === 'hidden')).toBe(list);
  });
});

describe('parseChapterFeed (MangaDex)', () => {
  it('deduplicates the same chapter from several scanlation groups', () => {
    const json = {
      data: [
        { id: 'id-1', attributes: { chapter: '5', volume: '1', translatedLanguage: 'ru' } },
        { id: 'id-2', attributes: { chapter: '5', volume: '1', translatedLanguage: 'ru' } },
        { id: 'id-3', attributes: { chapter: '6', volume: '1', translatedLanguage: 'ru' } },
        { id: 'id-4', attributes: { chapter: null, volume: '1', translatedLanguage: 'ru' } },
        { id: 'id-5', attributes: { chapter: null, volume: '1', translatedLanguage: 'ru' } },
      ],
    };
    const out = parseChapterFeed(json);
    expect(out.map((c) => c.chapter_id)).toEqual(['id-1', 'id-3', 'id-4', 'id-5']);
  });
});

describe('mangalibChapterUrl', () => {
  it('uses the API chapter number unchanged and ignores number_secondary', () => {
    const base = { id: 1, volume: '1', number: '10', numberSecondary: null, name: 'x' };
    expect(mangalibChapterUrl('7580--name', base)).toContain('/c10');
    const fraction = { ...base, number: '10.5', numberSecondary: '5' };
    expect(mangalibChapterUrl('7580--name', fraction)).toContain('/c10.5');
    expect(mangalibChapterUrl('7580--name', fraction)).not.toContain('/c10.5.5');
    const secondaryOnly = { ...base, numberSecondary: '5' };
    expect(mangalibChapterUrl('7580--name', secondaryOnly)).toContain('/c10');
  });
});

describe('Senkuro series URL', () => {
  it('derives the manga URL from a chapter URL (chapter list needs the slug)', () => {
    const chapter = 'https://senkuro.me/manga/the-beginning-after-the-end/chapter/50972894133510584';
    expect(senkuroMangaSlugFromUrl(chapter)).toBe('the-beginning-after-the-end');
    expect(senkuroSeriesUrlFromChapterUrl(chapter)).toBe('https://senkuro.me/manga/the-beginning-after-the-end/');
    expect(senkuroSeriesUrlFromChapterUrl('https://senkuro.com/manga/x/chapter/1')).toBe('https://senkuro.com/manga/x/');
    expect(senkuroSeriesUrlFromChapterUrl('https://example.com/not-senkuro')).toBeNull();
  });
});

describe('parseEhBanSeconds (exact ban duration from the page)', () => {
  it('parses minutes and seconds', () => {
    expect(parseEhBanSeconds('The ban expires in 13 minutes and 50 seconds')).toBe(830);
  });
  it('parses hours and minutes', () => {
    expect(parseEhBanSeconds('This IP address has been temporarily banned ... The ban expires in 1 hour and 2 minutes')).toBe(3720);
  });
  it('parses seconds only', () => {
    expect(parseEhBanSeconds('The ban expires in 45 seconds')).toBe(45);
  });
  it('returns null when the page does not state a duration', () => {
    expect(parseEhBanSeconds('excessive request rate')).toBeNull();
  });
});

describe('parseExitFingerprints (Tor exit rotation)', () => {  const A = 'A'.repeat(40);
  const B = 'B'.repeat(40);
  const C = 'C'.repeat(40);
  it('takes the exit of a full 3-hop path', () => {
    const reply = [
      '250+circuit-status=',
      `1 BUILT $${A}~bridge,$${B}~middle,$${C}~exit BUILD_FLAGS=NEED_CAPACITY PURPOSE=GENERAL`,
      '.',
      '250 OK',
    ].join('\n');
    expect(parseExitFingerprints(reply)).toEqual([C]);
  });

  it('ignores one-hop bridge circuits (excluding one broke Tor connectivity)', () => {
    const reply = [
      '250+circuit-status=',
      `1 BUILT $${A}~bridge BUILD_FLAGS= PURPOSE=GENERAL`,
      '.',
      '250 OK',
    ].join('\n');
    expect(parseExitFingerprints(reply)).toEqual([]);
  });

  it('ignores non-GENERAL circuits', () => {
    const reply = `3 BUILT $${A}~g,$${B}~m,$${C}~e PURPOSE=HS_CLIENT_REND\n`;
    expect(parseExitFingerprints(reply)).toEqual([]);
  });
});
