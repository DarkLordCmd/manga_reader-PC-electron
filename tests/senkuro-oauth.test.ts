import { describe, it, expect } from 'vitest';
import {
  SENKURO_OAUTH_CLIENT_ID,
  SENKURO_OAUTH_REDIRECT_URI,
  makePkcePair,
  parseSenkuroCallback,
  pkceChallenge,
  randomUrlSafe,
  senkuroAuthorizeUrl,
} from '../src/main/services/senkuro-oauth';

describe('PKCE', () => {
  it('matches the RFC 7636 S256 example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('produces a verifier from the unreserved set and a matching challenge', () => {
    const { verifier, challenge } = makePkcePair();
    expect(verifier).toHaveLength(64);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(challenge).toBe(pkceChallenge(verifier));
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/); // base64url, no padding
    expect(challenge).not.toContain('=');
  });

  it('is deterministic for a given random source', () => {
    const bytes = (n: number): Buffer => Buffer.alloc(n, 0); // index 0 → 'A'
    expect(randomUrlSafe(8, bytes)).toBe('AAAAAAAA');
    const pair = makePkcePair(bytes);
    expect(pair.verifier).toBe('A'.repeat(64));
    expect(pair.challenge).toBe(pkceChallenge('A'.repeat(64)));
  });
});

describe('Senkuro authorize URL', () => {
  it('carries every OAuth parameter the site sends', () => {
    const url = new URL(
      senkuroAuthorizeUrl({ ssoBase: 'https://sso.senkuro.net', state: 'st4te', challenge: 'ch4llenge' }),
    );
    expect(url.origin + url.pathname).toBe('https://sso.senkuro.net/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(SENKURO_OAUTH_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(SENKURO_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe('identify email');
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('code_challenge')).toBe('ch4llenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('tolerates a trailing slash on the SSO base', () => {
    expect(senkuroAuthorizeUrl({ ssoBase: 'https://sso.senkuro.org/', state: 's', challenge: 'c' })).toContain(
      'https://sso.senkuro.org/oauth/authorize?',
    );
  });
});

describe('OAuth callback parsing', () => {
  const cb = SENKURO_OAUTH_REDIRECT_URI;

  it('extracts code and state', () => {
    const r = parseSenkuroCallback(`${cb}?code=abc123&state=xyz`);
    expect(r).toEqual({ code: 'abc123', state: 'xyz', error: null });
  });

  it('accepts the .me callback and a trailing slash', () => {
    expect(parseSenkuroCallback('https://senkuro.me/auth/oauth/callback/?code=c&state=s')).toEqual({
      code: 'c',
      state: 's',
      error: null,
    });
  });

  it('reports a cancelled login', () => {
    expect(parseSenkuroCallback(`${cb}?error=access_denied&state=s`)).toEqual({
      code: '',
      state: 's',
      error: 'access_denied',
    });
  });

  it('ignores every other URL', () => {
    expect(parseSenkuroCallback('https://senkuro.com/browse/manga')).toBeNull();
    expect(parseSenkuroCallback('https://senkuro.com/auth/login?return_to=x')).toBeNull();
    expect(parseSenkuroCallback('https://evil.com/auth/oauth/callback?code=x')).toBeNull();
    expect(parseSenkuroCallback('https://senkuro.com.evil.com/auth/oauth/callback?code=x')).toBeNull();
    expect(parseSenkuroCallback('not a url')).toBeNull();
  });
});
