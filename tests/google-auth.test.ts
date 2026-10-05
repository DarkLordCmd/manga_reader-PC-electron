import { describe, it, expect } from 'vitest'
import { buildCodeVerifier, codeChallenge, buildAuthUrl, parseLoopbackQuery } from '../src/main/services/google-auth'

describe('PKCE', () => {
  it('verifier is url-safe and challenge is deterministic base64url sha256', () => {
    const v = buildCodeVerifier()
    expect(v).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    const c = codeChallenge(v)
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(codeChallenge(v)).toBe(c)
    expect(c).not.toContain('=')
  })
})

describe('buildAuthUrl', () => {
  it('contains required params', () => {
    const u = new URL(buildAuthUrl('CID', 'http://127.0.0.1:1234', 'CHAL'))
    expect(u.hostname).toBe('accounts.google.com')
    expect(u.searchParams.get('client_id')).toBe('CID')
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1234')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('code_challenge')).toBe('CHAL')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
    expect(u.searchParams.get('scope')).toContain('drive.appdata')
  })
})

describe('parseLoopbackQuery', () => {
  it('extracts code and error', () => {
    expect(parseLoopbackQuery('http://127.0.0.1:5/?code=abc&scope=x').code).toBe('abc')
    expect(parseLoopbackQuery('http://127.0.0.1:5/?error=access_denied').error).toBe('access_denied')
    expect(parseLoopbackQuery('http://127.0.0.1:5/?code=a').error).toBeNull()
  })
})
