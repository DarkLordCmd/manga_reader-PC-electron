import { describe, it, expect } from 'vitest'
import { parseAccountsFromJson, accountCookieHeader, parseCookieLogin } from '../src/main/services/accounts-parse'

describe('parseAccountsFromJson', () => {
  it('parses a bare cookie array', () => {
    const accounts = parseAccountsFromJson('[{"name":"ipb_member_id","value":"1"},{"name":"ipb_pass_hash","value":"h"}]')
    expect(accounts).toHaveLength(1)
    expect(accounts[0].name).toBe('Импортированный аккаунт')
    expect(accounts[0].cookies).toContainEqual(['ipb_member_id', '1'])
  })

  it('parses the Share pool with the s type tag', () => {
    const content = JSON.stringify({
      data: {
        Share: 's{"1":[{"name":"ipb_member_id","value":"a"}],"2":[{"name":"ipb_member_id","value":"b"}]}'
      }
    })
    const accounts = parseAccountsFromJson(content)
    expect(accounts.map((a) => a.name)).toEqual(['Аккаунт 1', 'Аккаунт 2'])
    expect(accounts[0].id).toBe(1)
  })

  it('parses a single active session', () => {
    const content = JSON.stringify({
      data: { 'E/Ex_Cookies': 's[{"name":"ipb_member_id","value":"42"}]' }
    })
    const accounts = parseAccountsFromJson(content)
    expect(accounts).toHaveLength(1)
    expect(accounts[0].name).toBe('Текущая сессия браузера')
  })

  it('tolerates key/value shape and returns empty for junk', () => {
    expect(parseAccountsFromJson('not json')).toEqual([])
    const accounts = parseAccountsFromJson('[{"key":"k","value":"v"}]')
    expect(accounts[0].cookies).toContainEqual(['k', 'v'])
  })
})

describe('parseCookieLogin', () => {
  it('extracts ipb_member_id, ipb_pass_hash and igneous from clipboard text', () => {
    const p = parseCookieLogin('ipb_member_id=12345; ipb_pass_hash=abc; igneous=xyz; nw=1')
    expect(p).toEqual({ ipbMemberId: '12345', ipbPassHash: 'abc', igneous: 'xyz' })
  })
  it('tolerates ":" colon and quoted values', () => {
    const p = parseCookieLogin('ipb_member_id: "67890", ipb_pass_hash: "def"')
    expect(p.ipbMemberId).toBe('67890')
    expect(p.ipbPassHash).toBe('def')
    expect(p.igneous).toBeNull()
  })
  it('returns nulls when nothing matches', () => {
    expect(parseCookieLogin('hello world')).toEqual({ ipbMemberId: null, ipbPassHash: null, igneous: null })
  })
})

describe('accountCookieHeader', () => {
  it('joins cookies into a header string', () => {
    expect(accountCookieHeader({ id: 1, name: 'x', cookies: [['a', '1'], ['b', '2']] })).toBe('a=1; b=2')
  })
  it('returns empty for null', () => {
    expect(accountCookieHeader(null)).toBe('')
  })
})