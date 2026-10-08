import { describe, it, expect, vi, beforeEach } from 'vitest';

const httpGetJson = vi.fn();
vi.mock('../src/main/services/http', () => ({ httpGetJson: (...a: any[]) => httpGetJson(...a) }));

import { searchRemanga } from '../src/main/services/sources/remanga';

describe('searchRemanga cover normalization', () => {
  beforeEach(() => {
    httpGetJson.mockReset();
  });
  it('prefixes relative cover paths with the site host', async () => {
    httpGetJson.mockResolvedValue({
      results: [{ dir: 'cattoon', main_name: 'Нарисованная котархия', cover: { high: '/media/titles/cattoon/x.jpg' } }],
    });
    const items = await searchRemanga('cattoon', 0, {});
    expect(items[0].coverUrl).toBe('https://remanga.org/media/titles/cattoon/x.jpg');
  });
  it('passes absolute covers through untouched', async () => {
    httpGetJson.mockResolvedValue({ results: [{ dir: 'x', cover: { high: 'https://cdn.remanga.org/pic.jpg' } }] });
    const items = await searchRemanga('x', 0, {});
    expect(items[0].coverUrl).toBe('https://cdn.remanga.org/pic.jpg');
  });
});
