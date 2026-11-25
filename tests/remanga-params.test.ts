import { describe, it, expect, vi, beforeEach } from 'vitest';

const httpGetJson = vi.fn();
vi.mock('../src/main/services/http', () => ({ httpGetJson: (...a: any[]) => httpGetJson(...a) }));
(globalThis as any).__mockRm = httpGetJson;

import { searchRemanga, setRemangaAuth } from '../src/main/services/sources/remanga';

describe('searchRemanga params', () => {
  beforeEach(() => {
    httpGetJson.mockReset();
    httpGetJson.mockResolvedValue([]);
  });
  it('uses views ordering by default and omits empty query', async () => {
    await searchRemanga('', 0, {});
    expect(httpGetJson).toHaveBeenCalledTimes(1);
    const url = httpGetJson.mock.calls[0][0] as string;
    expect(url).toContain('ordering=views');
    expect(url).not.toContain('query=');
  });
  it('sends the saved Remanga session to catalogue requests', async () => {
    setRemangaAuth('test-token', '');
    await searchRemanga('berserk', 0, {});
    const headers = httpGetJson.mock.calls[0][1] as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');

    setRemangaAuth('', 'sessionid=abc');
    await searchRemanga('berserk', 0, {});
    const cookieHeaders = httpGetJson.mock.calls[1][1] as Record<string, string>;
    expect(cookieHeaders.Cookie).toBe('sessionid=abc');
    setRemangaAuth('', '');
  });

  it('passes through chosen orderings', async () => {
    await searchRemanga('berserk', 0, { remangaOrdering: '-rating' });
    const url = httpGetJson.mock.calls[0][0] as string;
    expect(url).toContain('ordering=-rating');
    expect(url).toContain('query=berserk');
  });
});
