import { createHash, randomBytes } from 'crypto';

/**
 * Senkuro's own OAuth (authorization-code + PKCE) flow, mirrored from the
 * website bundle so the app can open the REAL authorization page instead of
 * the homepage with a login popup:
 *
 *   /oauth/authorize?… → 307 → /auth/login?return_to=…   (the auth page)
 *   …user logs in → redirect to /auth/oauth/callback?code=…&state=…
 *   → POST /oauth/token (code + code_verifier) → access_token
 *
 * The site stores that token in an `access_token` cookie, which is exactly what
 * our Senkuro API calls already read (`senkuroHeaders`), so completing the
 * exchange ourselves gives the app a usable session.
 */

/** OAuth client of the Senkuro website. The `.me` and `.com` configs share this
 * id (website-mode: senkuro.com → clientId 4026531840100), and it equals the
 * App-Id our GraphQL calls send. */
export const SENKURO_OAUTH_CLIENT_ID = '4026531840100';

/** Callback registered for that client. The login window intercepts this URL —
 * the page itself never loads. */
export const SENKURO_OAUTH_REDIRECT_URI = 'https://senkuro.com/auth/oauth/callback';

export const SENKURO_OAUTH_SCOPE = 'identify email';

/** `sso.senkuro.net` serves the RU site, `sso.senkuro.org` the global one; both
 * expose the same OAuth service, so either can run the login. */
export const SENKURO_SSO_HOSTS = ['https://sso.senkuro.net', 'https://sso.senkuro.org'] as const;

/** Cookie lifetime the website itself uses (maxAge 2630000 s ≈ 30 days). */
export const SENKURO_ACCESS_TOKEN_MAX_AGE_SEC = 2_630_000;

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** Random string from the RFC 7636 unreserved set (default 43-128 chars). */
export function randomUrlSafe(length: number, rnd: (n: number) => Buffer = randomBytes): string {
  const bytes = rnd(length);
  let out = '';
  for (let i = 0; i < length; i++) out += UNRESERVED[(bytes[i] ?? 0) % UNRESERVED.length];
  return out;
}

/** S256 code challenge: base64url(sha256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier, 'utf8')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function makePkcePair(rnd: (n: number) => Buffer = randomBytes): { verifier: string; challenge: string } {
  const verifier = randomUrlSafe(64, rnd);
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function senkuroAuthorizeUrl(opts: {
  ssoBase: string;
  state: string;
  challenge: string;
  redirectUri?: string;
  clientId?: string;
}): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId ?? SENKURO_OAUTH_CLIENT_ID,
    redirect_uri: opts.redirectUri ?? SENKURO_OAUTH_REDIRECT_URI,
    scope: SENKURO_OAUTH_SCOPE,
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
  });
  return `${opts.ssoBase.replace(/\/+$/, '')}/oauth/authorize?${q.toString()}`;
}

export interface SenkuroCallback {
  code: string;
  state: string;
  /** OAuth error code (`access_denied`, …) when the user cancelled. */
  error: string | null;
}

/** Parses `https://senkuro.{me,com}/auth/oauth/callback?code=…&state=…`.
 * Returns null for any other URL so the request interceptor can ignore it. */
export function parseSenkuroCallback(rawUrl: string): SenkuroCallback | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/(^|\.)senkuro\.(me|com)$/i.test(u.hostname)) return null;
  if (!/\/auth\/oauth\/callback\/?$/.test(u.pathname)) return null;
  return {
    code: u.searchParams.get('code') ?? '',
    state: u.searchParams.get('state') ?? '',
    error: u.searchParams.get('error'),
  };
}
