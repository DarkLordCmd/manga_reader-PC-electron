import { describe, it, expect } from 'vitest';
import { createLoginPartition, filterLoginCookies, hasAuthenticatedSession } from '../src/main/services/login';

const c = (name: string, value = 'x'): { name: string; value: string } => ({ name, value });

describe('login window auto-close detection', () => {
  it('accepts ExHentai onion once the gateway form is gone and onikakushi is set', () => {
    expect(hasAuthenticatedSession('http://exhentai55ld2.onion', [c('onikakushi')], false)).toBe(true);
  });
  it('does not accept guest tunnel cookies on ExHentai onion', () => {
    expect(hasAuthenticatedSession('http://exhentai55ld2.onion', [c('onikakushi')], true)).toBe(false);
    expect(hasAuthenticatedSession('http://exhentai55ld2.onion', [c('tor_session')], false)).toBe(false);
  });
  it('accepts NHentai onion only with an access/refresh token', () => {
    expect(hasAuthenticatedSession('http://nhentaithbeuys.onion', [c('tor_session'), c('access_token')], false)).toBe(true);
    expect(hasAuthenticatedSession('http://nhentaithbeuys.onion', [c('tor_session')], false)).toBe(false);
  });
  it('does not auto-close clearnet NHentai (redirect flow handles it)', () => {
    expect(hasAuthenticatedSession('https://nhentai.net', [c('access_token')], false)).toBe(false);
  });
  it('accepts Senkuro after SSO', () => {
    expect(hasAuthenticatedSession('https://senkuro.me', [c('remixsid')], false)).toBe(true);
  });
});

describe('login session isolation', () => {
  it('uses a unique non-persistent partition for every login window', () => {
    const first = createLoginPartition();
    const second = createLoginPartition();
    expect(first).not.toBe(second);
    expect(first).not.toMatch(/^persist:/);
    expect(second).not.toMatch(/^persist:/);
  });

  it('collects only cookies belonging to the source site, not SSO providers', () => {
    const source = { domain: '.mangalib.me', name: 'mangalib_session', value: 'source-secret' };
    const auth = { domain: '.lib.social', name: 'token', value: 'source-auth' };
    const vk = { domain: '.vk.com', name: 'vk_session', value: 'sso-secret' };
    const google = { domain: '.google.com', name: 'SID', value: 'sso-secret' };
    expect(filterLoginCookies('https://mangalib.me/', [source, auth, vk, google])).toEqual([source, auth]);
    expect(
      filterLoginCookies('https://senkuro.me/', [
        { domain: '.senkuro.com', name: 'access_token', value: 'token' },
        { domain: '.senkuro.net', name: 'sso_session', value: 'sso-secret' },
      ]),
    ).toEqual([{ domain: '.senkuro.com', name: 'access_token', value: 'token' }]);
    expect(
      filterLoginCookies('https://exhentai.org/', [
        { domain: '.e-hentai.org', name: 'ipb_member_id', value: '42' },
        { domain: '.vk.com', name: 'vk_session', value: 'sso-secret' },
      ]),
    ).toEqual([{ domain: '.e-hentai.org', name: 'ipb_member_id', value: '42' }]);
  });
});
