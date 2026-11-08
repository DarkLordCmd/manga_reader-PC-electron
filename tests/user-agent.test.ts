import { describe, it, expect } from 'vitest';
import { BROWSER_UA, isMangaDexHostUrl, userAgentForUrl } from '../src/main/services/user-agent';

describe('isMangaDexHostUrl', () => {
  it('matches every MangaDex host, including subdomains', () => {
    expect(isMangaDexHostUrl('https://api.mangadex.org/manga?limit=1')).toBe(true);
    expect(isMangaDexHostUrl('https://uploads.mangadex.org/covers/a/b.jpg')).toBe(true);
    expect(isMangaDexHostUrl('https://mangadex.org/edge/challenge?src=x')).toBe(true);
    expect(isMangaDexHostUrl('https://cmdxd98sb0x3yprd.mangadex.network/data/h/1.png')).toBe(true);
  });

  it('does not match lookalike or unrelated hosts', () => {
    expect(isMangaDexHostUrl('https://mangadex.org.evil.example/manga')).toBe(false);
    expect(isMangaDexHostUrl('https://notmangadex.org/manga')).toBe(false);
    expect(isMangaDexHostUrl('https://nhentai.net/g/1/')).toBe(false);
    expect(isMangaDexHostUrl('not a url')).toBe(false);
  });
});

describe('userAgentForUrl', () => {
  // MangaDex's edge answers a browser-shaped UA without its challenge cookie
  // with 302 -> /edge/challenge and then 403 "Bot challenge not passed".
  it('sends an app UA, never a browser UA, to MangaDex hosts', () => {
    const ua = userAgentForUrl('https://api.mangadex.org/manga?limit=30');
    expect(ua).toMatch(/^manga_reader-electron\//);
    expect(ua).not.toContain('Mozilla/5.0');
    expect(ua).toContain('Electron');
    expect(userAgentForUrl('https://uploads.mangadex.org/covers/a/b.jpg')).toBe(ua);
  });

  it('keeps the browser UA for every other source', () => {
    expect(userAgentForUrl('https://nhentai.net/g/1/')).toBe(BROWSER_UA);
    expect(userAgentForUrl('https://e-hentai.org/s/abc/1-1')).toBe(BROWSER_UA);
  });
});
