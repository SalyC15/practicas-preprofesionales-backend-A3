import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthConfig } from './auth.config'
import { AUTH_DEFAULTS } from './auth.constants'

describe('AuthConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('rejects missing or empty JWT_SECRET', () => {
    delete process.env.JWT_SECRET
    expect(() => AuthConfig.getJwtSecret()).toThrow('JWT_SECRET no configurado')

    process.env.JWT_SECRET = '   '
    expect(() => AuthConfig.getJwtSecret()).toThrow('JWT_SECRET no configurado')
  })

  it('rejects insecure known fallback default (D-07)', () => {
    process.env.JWT_SECRET = AUTH_DEFAULTS.INSECURE_SECRET_FALLBACK
    expect(() => AuthConfig.getJwtSecret()).toThrow('JWT_SECRET no puede usar el valor inseguro')
  })

  it('accepts valid secure JWT_SECRET', () => {
    process.env.JWT_SECRET = 'super-secret-jwt-key-for-testing-123456'
    expect(AuthConfig.getJwtSecret()).toBe('super-secret-jwt-key-for-testing-123456')
  })

  it('parses valid positive integer access token TTL', () => {
    process.env.AUTH_ACCESS_TOKEN_TTL_SEC = '1200'
    expect(AuthConfig.getAccessTokenTtlSec()).toBe(1200)
  })

  it('rejects junk non-integer access token TTL (e.g. 900junk)', () => {
    process.env.AUTH_ACCESS_TOKEN_TTL_SEC = '900junk'
    expect(() => AuthConfig.getAccessTokenTtlSec()).toThrow('entero positivo')
  })

  it('rejects out of bounds access token TTL', () => {
    process.env.AUTH_ACCESS_TOKEN_TTL_SEC = '10' // < 60s
    expect(() => AuthConfig.getAccessTokenTtlSec()).toThrow('fuera del rango')

    process.env.AUTH_ACCESS_TOKEN_TTL_SEC = '999999' // > 86400s
    expect(() => AuthConfig.getAccessTokenTtlSec()).toThrow('fuera del rango')
  })

  it('rejects refresh token TTL shorter than double access token TTL', () => {
    process.env.AUTH_ACCESS_TOKEN_TTL_SEC = '3600'
    process.env.AUTH_REFRESH_TOKEN_TTL_SEC = '3600' // not > 2 * 3600
    expect(() => AuthConfig.getRefreshTokenTtlSec()).toThrow('debe ser al menos el doble')
  })

  describe('E3-04: Inicialización del sistema sin secreto de firma', () => {
    it('falla al compilar el módulo de autenticación si falta JWT_SECRET con mensaje útil', async () => {
      delete process.env.JWT_SECRET
      const { AuthModule } = await import('./auth.module')
      const { PrismaModule } = await import('../prisma/prisma.module')
      const { Test } = await import('@nestjs/testing')

      await expect(
        Test.createTestingModule({
          imports: [PrismaModule, AuthModule],
        }).compile(),
      ).rejects.toThrow('JWT_SECRET no configurado en las variables de entorno')
    })

    it('falla si JWT_SECRET usa el valor inseguro conocido de D-07', async () => {
      process.env.JWT_SECRET = AUTH_DEFAULTS.INSECURE_SECRET_FALLBACK
      const { AuthModule } = await import('./auth.module')
      const { PrismaModule } = await import('../prisma/prisma.module')
      const { Test } = await import('@nestjs/testing')

      await expect(
        Test.createTestingModule({
          imports: [PrismaModule, AuthModule],
        }).compile(),
      ).rejects.toThrow('JWT_SECRET no puede usar el valor inseguro por defecto documentado en D-07')
    })

    it('arranca con normalidad cuando la variable de entorno JWT_SECRET está presente', async () => {
      process.env.JWT_SECRET = 'valid-test-secret-at-least-32-chars-long'
      const { AuthModule } = await import('./auth.module')
      const { PrismaModule } = await import('../prisma/prisma.module')
      const { Test } = await import('@nestjs/testing')

      const module = await Test.createTestingModule({
        imports: [PrismaModule, AuthModule],
      }).compile()

      expect(module).toBeDefined()
    })
  })
})
