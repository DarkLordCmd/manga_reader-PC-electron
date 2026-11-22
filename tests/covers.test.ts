import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/main/services/http', () => ({ httpFetchBinary: vi.fn() }));

import { httpFetchBinary } from '../src/main/services/http';
import {
  ehClearnetCoverFallbacks,
  fetchCoverBuffer,
  setCoverTorResolver,
  clearCoverFailureCache,
} from '../src/main/services/covers';
import { defaultSettings, type Settings } from '../src/shared/settings';

const ONION = 'http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion';
const ONION_COVER = `${ONION}/w/02/732/41976-84jgcuvj.webp`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

function settings(over: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), tor_socks_addr: '127.0.0.1:9153', tor_proxied_sites: ['ehentai'], ...over };
}

const fetchMock = vi.mocked(httpFetchBinary);

describe('ehClearnetCoverFallbacks', () => {
  it('maps onion H@H thumbnails to the shared CDN', () => {
    expect(ehClearnetCoverFallbacks(ONION_COVER)).toEqual([
      'https://ehgt.org/w/02/732/41976-84jgcuvj.webp',
      'https://s.exhentai.org/w/02/732/41976-84jgcuvj.webp',
    ]);
  });

  it('maps site-served onion thumbnails to the clearnet gallery hosts', () => {
    expect(ehClearnetCoverFallbacks(`${ONION}/t/3.jpg`)).toEqual([
      'https://exhentai.org/t/3.jpg',
      'https://e-hentai.org/t/3.jpg',
    ]);
  });

  it('ignores clearnet and non-EH onion urls', () => {
    expect(ehClearnetCoverFallbacks('https://ehgt.org/w/02/1/2.webp')).toEqual([]);
    expect(ehClearnetCoverFallbacks('http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion/g/1/cover.jpg')).toEqual([]);
    expect(ehClearnetCoverFallbacks('not a url')).toEqual([]);
  });
});

beforeEach(() => clearCoverFailureCache());

describe('fetchCoverBuffer onion fallback', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    setCoverTorResolver(null);
  });

  afterEach(() => {
    setCoverTorResolver(null);
  });

  it('serves H@H thumbnails from the clearnet copy first (real observed case)', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error(`HTTP 404 for https://ehgt.org${'/w/02/732/41976-84jgcuvj.webp'}`))
      .mockResolvedValueOnce(new Uint8Array(JPEG));

    await expect(fetchCoverBuffer(ONION_COVER, settings(), '')).resolves.toEqual(JPEG);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // /w/ thumbnails 404/HTML on the onion mirror, so ehgt.org goes first.
    expect(fetchMock.mock.calls[0][0]).toBe('https://ehgt.org/w/02/732/41976-84jgcuvj.webp');
    const [url, headers, proxy] = fetchMock.mock.calls[1];
    expect(url).toBe('https://s.exhentai.org/w/02/732/41976-84jgcuvj.webp');
    expect(headers).toMatchObject({ Referer: 'https://exhentai.org/' });
    // The fallback keeps the same Tor route the onion request used.
    expect(proxy).toBe('127.0.0.1:9153');
  });

  it('does not mask an E-Hentai limit wall with a second host', async () => {
    const blocked = Object.assign(new Error('Превышен лимит изображений E-Hentai'), { ehBlocked: true });
    fetchMock.mockRejectedValueOnce(blocked);

    await expect(fetchCoverBuffer(ONION_COVER, settings(), '')).rejects.toBe(blocked);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats an HTML body as a failed cover and retries clearnet', async () => {
    fetchMock
      .mockResolvedValueOnce(new Uint8Array(Buffer.from('<!DOCTYPE html><html>login</html>')))
      .mockResolvedValueOnce(new Uint8Array(JPEG));

    await expect(fetchCoverBuffer(ONION_COVER, settings(), '')).resolves.toEqual(JPEG);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects when both the onion mirror and clearnet copies are HTML', async () => {
    const html = new Uint8Array(Buffer.from('<html>blocked</html>'));
    fetchMock.mockResolvedValue(html);

    await expect(fetchCoverBuffer(ONION_COVER, settings(), '')).rejects.toThrow(/HTML/);
    // original + both /w/ fallbacks
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses the embedded daemon address instead of a stale settings address', async () => {
    setCoverTorResolver(() => '127.0.0.1:9153');
    fetchMock.mockResolvedValueOnce(new Uint8Array(JPEG));

    await fetchCoverBuffer(ONION_COVER, settings({ tor_socks_addr: '127.0.0.1:9150' }), '');

    expect(fetchMock.mock.calls[0][2]).toBe('127.0.0.1:9153');
  });
});
