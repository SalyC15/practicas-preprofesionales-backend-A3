import { Role } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { validateJwtAuthPayload } from './auth-payload'

describe('validateJwtAuthPayload', () => {
  const validPayload = {
    sub: 1,
    email: 'user@miyura.com',
    role: Role.STUDENT,
    sessionId: 'sess-uuid-1234',
    generation: 1,
    exp: 1743859200,
    iat: 1743858300,
  }

  it('accepts valid payload with safe integers and mandatory exp', () => {
    const validated = validateJwtAuthPayload(validPayload)
    expect(validated).toEqual(validPayload)
  })

  it('rejects payload missing exp or with non-finite/fractional exp', () => {
    expect(() => validateJwtAuthPayload({ ...validPayload, exp: undefined })).toThrow('exp')
    expect(() => validateJwtAuthPayload({ ...validPayload, exp: 'not-a-number' })).toThrow('exp')
    expect(() => validateJwtAuthPayload({ ...validPayload, exp: 123.45 })).toThrow('exp')
    expect(() => validateJwtAuthPayload({ ...validPayload, exp: Number.POSITIVE_INFINITY })).toThrow('exp')
  })

  it('rejects invalid or non-integer sub', () => {
    expect(() => validateJwtAuthPayload({ ...validPayload, sub: 0 })).toThrow('sub')
    expect(() => validateJwtAuthPayload({ ...validPayload, sub: -5 })).toThrow('sub')
    expect(() => validateJwtAuthPayload({ ...validPayload, sub: 1.5 })).toThrow('sub')
    expect(() => validateJwtAuthPayload({ ...validPayload, sub: '1' })).toThrow('sub')
  })

  it('rejects invalid, zero or fractional generation', () => {
    expect(() => validateJwtAuthPayload({ ...validPayload, generation: 0 })).toThrow('generation')
    expect(() => validateJwtAuthPayload({ ...validPayload, generation: -1 })).toThrow('generation')
    expect(() => validateJwtAuthPayload({ ...validPayload, generation: 2.5 })).toThrow('generation')
    expect(() => validateJwtAuthPayload({ ...validPayload, generation: '2' })).toThrow('generation')
  })

  it('rejects missing, empty or overly long sessionId', () => {
    expect(() => validateJwtAuthPayload({ ...validPayload, sessionId: '' })).toThrow('sessionId')
    expect(() => validateJwtAuthPayload({ ...validPayload, sessionId: '   ' })).toThrow('sessionId')
    expect(() => validateJwtAuthPayload({ ...validPayload, sessionId: 'a'.repeat(129) })).toThrow('sessionId')
  })

  it('validates role and email when required', () => {
    expect(() => validateJwtAuthPayload({ ...validPayload, role: 'INVALID_ROLE' as any })).toThrow('role')
    expect(() => validateJwtAuthPayload({ ...validPayload, email: 'not-an-email' })).toThrow('email')
  })
})
