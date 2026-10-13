import { UnauthorizedException } from '@nestjs/common'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '../../prisma/prisma.service'
import { JwtAuthGuard } from './jwt-auth.guard'

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard
  let jwtService: JwtService
  let prisma: {
    authSession: { findUnique: any }
  }

  const testSecret = 'secure-guard-test-secret-min-32-chars-long!!'

  beforeEach(async () => {
    prisma = {
      authSession: { findUnique: vi.fn() },
    }

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: testSecret,
          signOptions: { expiresIn: 900 },
        }),
      ],
      providers: [
        JwtAuthGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    guard = moduleRef.get<JwtAuthGuard>(JwtAuthGuard)
    jwtService = moduleRef.get<JwtService>(JwtService)
  })

  function mockContext(authHeader?: string) {
    const req: any = {
      headers: {
        authorization: authHeader,
      },
    }
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      req,
    }
  }

  it('allows access when token is valid and generation matches live DB session', async () => {
    const token = await jwtService.signAsync({
      sub: 1,
      email: 'student@miyura.com',
      role: 'STUDENT',
      sessionId: 'sess-100',
      generation: 2,
    })

    prisma.authSession.findUnique.mockResolvedValue({
      id: 'sess-100',
      userId: 1,
      generation: 2,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
    })

    const { req, ...ctx } = mockContext(`Bearer ${token}`)
    const result = await guard.canActivate(ctx as any)

    expect(result).toBe(true)
    expect(req.user).toBeDefined()
    expect(req.user.sessionId).toBe('sess-100')
    expect(req.user.generation).toBe(2)
  })

  it('immediately rejects old access token after renewal advances generation in DB', async () => {
    // Old token with generation 1
    const oldToken = await jwtService.signAsync({
      sub: 1,
      email: 'student@miyura.com',
      role: 'STUDENT',
      sessionId: 'sess-100',
      generation: 1,
    })

    // Session in DB has already advanced to generation 2
    prisma.authSession.findUnique.mockResolvedValue({
      id: 'sess-100',
      userId: 1,
      generation: 2,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
    })

    const ctx = mockContext(`Bearer ${oldToken}`)
    await expect(guard.canActivate(ctx as any)).rejects.toThrow(
      'token revocado por renovación de sesión',
    )
  })

  it('rejects access token when session has been revoked', async () => {
    const token = await jwtService.signAsync({
      sub: 1,
      email: 'student@miyura.com',
      role: 'STUDENT',
      sessionId: 'sess-100',
      generation: 1,
    })

    prisma.authSession.findUnique.mockResolvedValue({
      id: 'sess-100',
      userId: 1,
      generation: 1,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    })

    const ctx = mockContext(`Bearer ${token}`)
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('sesión inválida o expirada')
  })

  it('rejects request with missing or malformed authorization header', async () => {
    const ctx1 = mockContext(undefined)
    await expect(guard.canActivate(ctx1 as any)).rejects.toThrow('falta el token')

    const ctx2 = mockContext('Basic 1234')
    await expect(guard.canActivate(ctx2 as any)).rejects.toThrow('falta el token')
  })

  it('rejects access token when token claims are missing session info', async () => {
    const tokenWithoutSession = await jwtService.signAsync({
      sub: 1,
      email: 'student@miyura.com',
      role: 'STUDENT',
    })

    const ctx = mockContext(`Bearer ${tokenWithoutSession}`)
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('estructura de sesión inválida')
  })

  it('rejects access token when session owner userId does not match token sub', async () => {
    const token = await jwtService.signAsync({
      sub: 1,
      email: 'student@miyura.com',
      role: 'STUDENT',
      sessionId: 'sess-100',
      generation: 1,
    })

    // Session in DB belongs to user 999, not user 1
    prisma.authSession.findUnique.mockResolvedValue({
      id: 'sess-100',
      userId: 999,
      generation: 1,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
    })

    const ctx = mockContext(`Bearer ${token}`)
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('propietario de sesión no coincide')
  })

  it('rejects signed token with fractional generation or invalid types', async () => {
    const token = await jwtService.signAsync({
      sub: 1,
      email: 'student@miyura.com',
      role: 'STUDENT',
      sessionId: 'sess-100',
      generation: 1.5,
    })

    const ctx = mockContext(`Bearer ${token}`)
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('estructura de sesión inválida')
  })

  it('rejects signed token missing exp claim', async () => {
    // Bare JwtService without default expiresIn
    const bareJwt = new JwtService({ secret: testSecret })
    const tokenWithoutExp = await bareJwt.signAsync({
      sub: 1,
      email: 'student@miyura.com',
      role: 'STUDENT',
      sessionId: 'sess-100',
      generation: 1,
    })

    // Verify raw token has no exp
    const decoded = jwtService.decode(tokenWithoutExp)
    expect(decoded.exp).toBeUndefined()

    const ctx = mockContext(`Bearer ${tokenWithoutExp}`)
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('estructura de sesión inválida')
  })
})
