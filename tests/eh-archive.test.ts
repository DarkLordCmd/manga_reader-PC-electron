import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseArchiverPage, buyArchive } from '../src/main/services/eh-archive';
import { httpFetch } from '../src/main/services/http';

vi.mock('../src/main/services/http', () => ({ httpFetch: vi.fn() }));

const html = readFileSync(join('tests', 'fixtures', 'eh-archiver.html'), 'utf-8');

describe('parseArchiverPage', () => {
  it('parses cost and options', () => {
    const r = parseArchiverPage(html);
    expect(r).not.toBeNull();
    expect(r!.costGp).toBe(100);
    expect(r!.options.map((o) => o.key)).toEqual(['org', 'res']);
    expect(r!.archiverUrl).toContain('archiver.php');
  });

  it('returns null for empty or limit page', () => {
    expect(parseArchiverPage('')).toBeNull();
    expect(parseArchiverPage('You have exceeded your usage limit')).toBeNull();
    expect(parseArchiverPage('<html><body>nothing</body></html>')).toBeNull();
  });
});

describe('buyArchive', () => {
  it('resolves quoted relative /dl/ link against the archiver URL', async () => {
    vi.mocked(httpFetch).mockResolvedValue({
      status: 200,
      text: 'document.location="/dl/2024-01/abc123-def456.zip";',
      setCookies: [],
    });
    const r = await buyArchive('https://e-hentai.org/archiver.php?gid=1&t=abc', {});
    expect(r).toEqual({ downloadUrl: 'https://e-hentai.org/dl/2024-01/abc123-def456.zip' });
  });

  it('prefers a full URL match over the relative fallback', async () => {
    vi.mocked(httpFetch).mockResolvedValue({
      status: 200,
      text: '<a href="/dl/x/y.zip">"https://e-hentai.org/dl/full/url.zip"</a>',
      setCookies: [],
    });
    const r = await buyArchive('https://e-hentai.org/archiver.php', {});
    expect(r).toEqual({ downloadUrl: 'https://e-hentai.org/dl/full/url.zip' });
  });
});
