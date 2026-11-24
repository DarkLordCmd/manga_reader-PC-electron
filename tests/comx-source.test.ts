import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieForHost = vi.fn();
const fetchHtmlViaBrowser = vi.fn();
vi.mock('../src/main/services/comx-gate', () => ({
  comxFetchText: vi.fn(),
  cookieForHost: (...args: unknown[]) => cookieForHost(...args),
}));
vi.mock('../src/main/services/browser-fetch', () => ({
  fetchHtmlViaBrowser: (...args: unknown[]) => fetchHtmlViaBrowser(...args),
}));

import { fetchComxChapters } from '../src/main/services/sources/comx';

const chapterHtml = '<html><body><a href="/reader/100/2">Глава 2</a></body></html>';

describe('Com-X browser account cookies', () => {
  beforeEach(() => {
    cookieForHost.mockReset();
    fetchHtmlViaBrowser.mockReset();
    fetchHtmlViaBrowser.mockResolvedValue(chapterHtml);
  });

  it('uses the www host jar and cookie scope for www chapter URLs', async () => {
    cookieForHost.mockImplementation((host: string) => (host === 'www.com-x.life' ? 'sid=www-account' : 'sid=apex-account'));

    await fetchComxChapters('https://www.com-x.life/reader/100/2.html', 'socks5://127.0.0.1:9050');

    expect(fetchHtmlViaBrowser).toHaveBeenCalledWith('https://www.com-x.life/reader/100/2.html', {
      timeoutMs: 60_000,
      proxy: 'socks5://127.0.0.1:9050',
      cookie: 'sid=www-account',
      cookieHost: 'www.com-x.life',
    });
  });

  it('keeps using the apex host jar and cookie scope for apex chapter URLs', async () => {
    cookieForHost.mockImplementation((host: string) => (host === 'com-x.life' ? 'sid=apex-account' : 'sid=www-account'));

    await fetchComxChapters('https://com-x.life/reader/100/2.html');

    expect(fetchHtmlViaBrowser).toHaveBeenCalledWith('https://com-x.life/reader/100/2.html', {
      timeoutMs: 60_000,
      proxy: undefined,
      cookie: 'sid=apex-account',
      cookieHost: 'com-x.life',
    });
  });

  it('propagates an empty cookie string so an explicit logout reaches the browser jar', async () => {
    cookieForHost.mockReturnValue('');

    await fetchComxChapters('https://www.com-x.life/reader/100/2.html');

    expect(fetchHtmlViaBrowser).toHaveBeenCalledWith(
      'https://www.com-x.life/reader/100/2.html',
      expect.objectContaining({ cookie: '', cookieHost: 'www.com-x.life' }),
    );
  });
});
