import { describe, expect, it } from 'vitest'
import {
  findSessionCookies,
  getClearCookieOptions,
  getCookieOptions,
  getGenerationCookieName,
  parseCookies,
  parseGenerationCookieName,
} from './cookie.util'

describe('cookie.util', () => {
  it('formats generation-specific cookie name', () => {
    expect(getGenerationCookieName('sess-uuid-1', 1)).toBe('rt_sess-uuid-1_g1')
    expect(getGenerationCookieName('sess-uuid-1', 4)).toBe('rt_sess-uuid-1_g4')
  })

  it('parses valid generation-specific cookie name', () => {
    const parsed = parseGenerationCookieName('rt_sess-uuid-1_g2')
    expect(parsed).toEqual({
      sessionId: 'sess-uuid-1',
      generation: 2,
    })
  })

  it('returns null for invalid cookie names', () => {
    expect(parseGenerationCookieName('random_cookie')).toBeNull()
    expect(parseGenerationCookieName('rt_invalid')).toBeNull()
    expect(parseGenerationCookieName('rt_sess_gjunk')).toBeNull()
    expect(parseGenerationCookieName('rt_sess_g0')).toBeNull()
    expect(parseGenerationCookieName('rt_sess_g-1')).toBeNull()
    expect(parseGenerationCookieName('rt__g1')).toBeNull()
    expect(parseGenerationCookieName(`rt_${'a'.repeat(65)}_g1`)).toBeNull()
  })

  it('parses cookies from header string safely', () => {
    const header = 'theme=dark; rt_s1_g1=secret123; other=abc%20123'
    const parsed = parseCookies(header)
    expect(parsed.theme).toBe('dark')
    expect(parsed.rt_s1_g1).toBe('secret123')
    expect(parsed.other).toBe('abc 123')
  })

  it('finds all cookies belonging to a session id', () => {
    const cookies = {
      rt_s1_g1: 'old',
      rt_s1_g2: 'current',
      rt_s2_g1: 'other_session',
      non_rt: 'val',
    }
    const matching = findSessionCookies(cookies, 's1')
    expect(matching).toEqual(['rt_s1_g1', 'rt_s1_g2'])
  })

  it('sets secure cookie options with path /api/auth', () => {
    const options = getCookieOptions(3600)
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe('strict')
    expect(options.path).toBe('/api/auth')
    expect(options.maxAge).toBe(3600 * 1000)
  })

  it('sets clear cookie options with path /api/auth and maxAge 0', () => {
    const options = getClearCookieOptions()
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe('strict')
    expect(options.path).toBe('/api/auth')
    expect(options.maxAge).toBe(0)
  })

  it('rejects oversized cookie header exceeding MAX_COOKIE_HEADER_BYTES', () => {
    const oversized = 'a='.repeat(2500) // > 4096 bytes
    expect(() => parseCookies(oversized)).toThrow('tamaño máximo permitido')
  })

  it('protects against prototype pollution in cookie keys', () => {
    const header = '__proto__=polluted; constructor=bad; prototype=evil; valid=ok'
    const parsed = parseCookies(header)
    expect(parsed.valid).toBe('ok')
    expect(parsed.__proto__).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(false)
  })

  it('findSessionCookies matches exact parsed identity without startsWith lookalike', () => {
    const cookies = {
      rt_s1_g1: 'val1',
      rt_s1_g2: 'val2',
      rt_s1_extra_g1: 'lookalike',
      rt_s10_g1: 'prefix_match_but_different_id',
    }
    const matching = findSessionCookies(cookies, 's1')
    expect(matching).toEqual(['rt_s1_g1', 'rt_s1_g2'])
    expect(matching).not.toContain('rt_s1_extra_g1')
    expect(matching).not.toContain('rt_s10_g1')
  })
})
