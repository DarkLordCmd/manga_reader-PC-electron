import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/settings';
import { fetchSourceTags } from '../src/main/services/source-tags';

// No network here: only the source gate is exercised (nhentai-only path).
describe('fetchSourceTags', () => {
  const settings = defaultSettings();
  const opts = { torSocks: '127.0.0.1:9153' };

  it('returns nothing for sources whose listing carries tags already', async () => {
    await expect(fetchSourceTags('https://mangadex.org/title/abc', settings, opts)).resolves.toEqual([]);
    await expect(fetchSourceTags('https://e-hentai.org/g/1/abc/', settings, opts)).resolves.toEqual([]);
    await expect(fetchSourceTags('https://exhentai.org/g/1/abc/', settings, opts)).resolves.toEqual([]);
  });

  it('returns nothing for non-http garbage', async () => {
    await expect(fetchSourceTags('not a url', settings, opts)).resolves.toEqual([]);
  });
});
