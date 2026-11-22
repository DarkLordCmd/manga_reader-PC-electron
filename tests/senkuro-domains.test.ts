import { describe, it, expect } from 'vitest';
import {
  isSenkuroHost,
  senkuroAlternateUrl,
  looksLikeAccessBlock,
  senkuroFallbackUrl,
} from '../src/main/services/senkuro-domains';

describe('senkuro domains', () => {
  it('recognises both domains and their subdomains', () => {
    expect(isSenkuroHost('https://senkuro.me/')).toBe(true);
    expect(isSenkuroHost('https://senkuro.com/browse/manga')).toBe(true);
    expect(isSenkuroHost('https://api.senkuro.me/graphql')).toBe(true);
    expect(isSenkuroHost('https://senkuro.me.evil.com/')).toBe(false);
    expect(isSenkuroHost('https://nhentai.net/')).toBe(false);
    expect(isSenkuroHost('not a url')).toBe(false);
  });

  it('swaps the apex domain, preserving path, query and hash', () => {
    expect(senkuroAlternateUrl('https://senkuro.me/')).toBe('https://senkuro.com/');
    expect(senkuroAlternateUrl('https://senkuro.com/browse/manga?page=2#top')).toBe('https://senkuro.me/browse/manga?page=2#top');
    expect(senkuroAlternateUrl('https://senkuro.me/login?next=%2Fxc')).toBe('https://senkuro.com/login?next=%2Fxc');
  });

  it('does not invent subdomain mirrors (sso./api. may not exist)', () => {
    expect(senkuroAlternateUrl('https://sso.senkuro.me/login')).toBeNull();
    expect(senkuroAlternateUrl('https://api.senkuro.me/graphql')).toBeNull();
  });

  it('ignores unrelated hosts and malformed URLs', () => {
    expect(senkuroAlternateUrl('https://nhentai.net/g/1/')).toBeNull();
    expect(senkuroAlternateUrl('not a url')).toBeNull();
  });
});

describe('DDoS-Guard access block', () => {
  // The exact screen users report: "senkuro.me недоступен / Владелец сайта
  // запретил доступ из вашей сети".
  const blockPage = [
    'DDoS-Guard',
    'senkuro.me недоступен',
    'Владелец сайта запретил доступ из вашей сети',
    'Почему это произошло и что можно сделать',
  ].join('\n');

  it('detects the reported block screen and returns the .com mirror', () => {
    expect(looksLikeAccessBlock(blockPage)).toBe(true);
    expect(senkuroFallbackUrl('https://senkuro.me/', blockPage)).toBe('https://senkuro.com/');
  });

  it('detects the English wording of the same page', () => {
    expect(looksLikeAccessBlock('DDoS-Guard — The owner of this website has banned your access from your network.')).toBe(true);
    expect(looksLikeAccessBlock('Access to this site is blocked')).toBe(true);
  });

  it('does NOT treat an interactive JS challenge as a block', () => {
    // The challenge resolves by itself; reloading onto another domain would
    // wipe the user's input and hide the real state.
    const challenge = 'DDoS-Guard\nПроверяем браузер… One moment, please.';
    expect(looksLikeAccessBlock(challenge)).toBe(false);
    expect(senkuroFallbackUrl('https://senkuro.me/', challenge)).toBeNull();
  });

  it('does not fire on a normal page that merely loads the guard script', () => {
    const normal =
      '<html><head><title>Senkuro</title><script src="https://ddos-guard.net/s.js"></script></head><body>Каталог манги</body></html>';
    expect(looksLikeAccessBlock(normal)).toBe(false);
    expect(senkuroFallbackUrl('https://senkuro.me/', normal)).toBeNull();
  });

  it('returns null for non-senkuro hosts even when the text looks blocked', () => {
    expect(senkuroFallbackUrl('https://nhentai.net/', blockPage)).toBeNull();
  });

  it('handles empty/missing text', () => {
    expect(looksLikeAccessBlock('')).toBe(false);
    expect(looksLikeAccessBlock(undefined as unknown as string)).toBe(false);
  });
});
