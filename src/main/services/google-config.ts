declare const __GOOGLE_CLIENT_SECRET__: string | undefined;

export const GOOGLE_CLIENT_ID = '59705917238-2tditham9qpns2gl7tecarqh77krg5bt.apps.googleusercontent.com';
// The secret for a desktop OAuth client is not confidential to Google, but it
// must not sit in a public repo (anyone could impersonate the app). Injected
// at build time from GOOGLE_CLIENT_SECRET; empty → Google sign-in is disabled.
export const GOOGLE_CLIENT_SECRET = typeof __GOOGLE_CLIENT_SECRET__ === 'string' ? __GOOGLE_CLIENT_SECRET__ : '';
export const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/drive.appdata';
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
