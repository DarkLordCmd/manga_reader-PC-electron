import { session, type Session } from 'electron'

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' manga: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ')

const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' manga: data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** CSP заголовком для документа главного окна (dev/prod раздельно). */
export function installAppCsp(devUrl: string | undefined): void {
  const policy = devUrl ? DEV_CSP : PROD_CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame') { callback({}); return }
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } })
  })
}

const CLIPBOARD_PERMS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'clipboard-sans-sanitized-write'])

/** Default-deny с allowlist буфера обмена (Settings читает clipboard). */
export function installDefaultPermissions(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(CLIPBOARD_PERMS.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => CLIPBOARD_PERMS.has(permission))
}

/** Полный deny (для скрейпер-окна и сессий логина). */
export function denyAllPermissions(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
}
