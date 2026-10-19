import { describe, it, expect } from 'vitest';
import { hasAuthenticatedSession } from '../src/main/services/login';

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
