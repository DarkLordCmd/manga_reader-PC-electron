import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/main/services/http', () => ({ httpFetch: vi.fn() }));

import { httpFetch } from '../src/main/services/http';
import { buildEhSearchParams, ehErrorFromResponse } from '../src/main/services/sources/eh';
import { verifyEhLogin } from '../src/main/services/eh-extras';

const mockedFetch = vi.mocked(httpFetch);

describe('verifyEhLogin (do not persist a guest session)', () => {
  beforeEach(() => mockedFetch.mockReset());

  it('rejects the login form page', async () => {
    mockedFetch.mockResolvedValue({ status: 200, text: '<form><input name="oni_user"><input name="oni_pass"></form>', setCookies: [] });
    const r = await verifyEhLogin('http://x.onion/', 'onikakushi=guest');
    expect(r.ok).toBe(false);
  });

  it('rejects an empty body (guest cookie made the site answer nothing)', async () => {
    mockedFetch.mockResolvedValue({ status: 200, text: '', setCookies: [] });
    const r = await verifyEhLogin('http://x.onion/', 'onikakushi=guest');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/пуст/);
  });

  it('rejects sad panda', async () => {
    mockedFetch.mockResolvedValue({ status: 200, text: '<div>Sad Panda</div>', setCookies: [] });
    expect((await verifyEhLogin('http://x.onion/', 'a=b')).ok).toBe(false);
  });

  it('accepts a real gallery front page', async () => {
    mockedFetch.mockResolvedValue({ status: 200, text: '<html><a href="/g/123/abc/">x</a></html>', setCookies: [] });
    expect((await verifyEhLogin('http://x.onion/', 'ipb_member_id=1')).ok).toBe(true);
  });
});


describe('EH search filters', () => {
  it('adds f_sh=1 for the watched-only filter', () => {
    expect(buildEhSearchParams({ query: '', watchedOnly: true })).toContain('f_sh=1');
  });

  it('does not add f_sh without the filter', () => {
    expect(buildEhSearchParams({ query: '' })).not.toContain('f_sh=1');
  });

  it('keeps query, category and rating params together', () => {
    const p = buildEhSearchParams({ query: 'test', excludedCats: 4, minRating: 3, watchedOnly: true });
    expect(p).toContain('f_search=test');
    expect(p).toContain('f_cats=4');
    expect(p).toContain('f_srdd=3');
    expect(p).toContain('f_sh=1');
  });
});

describe('EH error mapping', () => {
  it('names a removed gallery on 404', () => {
    const msg = ehErrorFromResponse(404, '<html><body><div class="d"><p>Gallery not found</p></div></body></html>');
    expect(msg).toMatch(/удалена|недоступна/i);
  });

  it('returns null for an ordinary page', () => {
    expect(ehErrorFromResponse(200, '<html>ok</html>')).toBeNull();
  });

  it('maps the image quota wall', () => {
    expect(ehErrorFromResponse(200, 'You have exceeded your image viewing limits')).toMatch(/лимит просмотра/i);
  });
});
