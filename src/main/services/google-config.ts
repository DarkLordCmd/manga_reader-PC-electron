export const GOOGLE_CLIENT_ID = '59705917238-2tditham9qpns2gl7tecarqh77krg5bt.apps.googleusercontent.com'
// Desktop OAuth clients must send the client secret at the token endpoint even
// with PKCE (Google returns "client_secret is missing" otherwise). Per Google,
// the secret for an installed app is not treated as confidential.
export const GOOGLE_CLIENT_SECRET = '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'
export const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/drive.appdata'
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
export const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo'
