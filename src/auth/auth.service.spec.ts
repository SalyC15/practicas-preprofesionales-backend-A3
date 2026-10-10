import * as crypto from 'node:crypto'
import { UnauthorizedException } from '@nestjs/common'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import * as bcrypt from 'bcryptjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '../prisma/prisma.service'
import { AuthConfig } from './auth.config'
import { AuthService } from './auth.service'
import { getGenerationCookieName } from './utils/cookie.util'

describe('AuthService', () => {
  let service: AuthService
  let jwtService: JwtService
  let prisma: {
    user: { findUnique: any }
    authSession: {
      findUnique: any
      findMany: any
      create: any
      updateMany: any
    }
  }

  const testSecret = 'secure-test-jwt-secret-with-high-entropy-1234'

  beforeEach(async () => {
    process.env.JWT_SECRET = testSecret
    process.env.AUTH_ACCESS_TOKEN_TTL_SEC = '900' // 15m
    process.env.AUTH_REFRESH_TOKEN_TTL_SEC = '604800' // 7d

    prisma = {
      user: { findUnique: vi.fn() },
      authSession: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
    }

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: testSecret,
          signOptions: { expiresIn: 900 },
        }),
      ],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    service = moduleRef.get<AuthService>(AuthService)
    jwtService = moduleRef.get<JwtService>(JwtService)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('login', () => {
    it('authenticates valid credentials, creates DB session and returns contract response', async () => {
      const passwordHash = await bcrypt.hash('yura1234', 10)
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'tutor0@miyura.com',
        password: passwordHash,
        fullName: 'Tutor 0',
        role: 'TUTOR',
        companyId: null,
      })
      prisma.authSession.create.mockResolvedValue({})

      const result = await service.login('tutor0@miyura.com', 'yura1234')

      expect(result.accessToken).toBeDefined()
      expect(typeof result.expiresAt).toBe('number')
      expect(result.expiresAt).toBeGreaterThan(Date.now())
      expect(result.user).toEqual({
        id: 1,
        email: 'tutor0@miyura.com',
        fullName: 'Tutor 0',
        role: 'TUTOR',
        companyId: null,
      })
      expect(result.sessionId).toBeDefined()
      expect(result.generation).toBe(1)
      expect(result.refreshTokenSecret).toBeDefined()

      // Prisma authSession create called
      expect(prisma.authSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 1,
          generation: 1,
          refreshTokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      })

      // Verify token payload structure
      const payload = await jwtService.verifyAsync(result.accessToken)
      expect(payload.sub).toBe(1)
      expect(payload.sessionId).toBe(result.sessionId)
      expect(payload.generation).toBe(1)
    })

    it('rejects invalid password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'tutor0@miyura.com',
        password: await bcrypt.hash('other', 10),
        fullName: 'Tutor 0',
        role: 'TUTOR',
        companyId: null,
      })

      await expect(service.login('tutor0@miyura.com', 'yura1234')).rejects.toThrow(
        UnauthorizedException,
      )
    })

    it('retires previous presented session when possession proof matches DB record', async () => {
      const passwordHash = await bcrypt.hash('yura1234', 10)
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'tutor0@miyura.com',
        password: passwordHash,
        fullName: 'Tutor 0',
        role: 'TUTOR',
        companyId: null,
      })

      // Simulate prior session cookie presented in browser
      const priorSecret = 'prior-valid-secret-123'
      const priorHash = crypto.createHash('sha256').update(priorSecret).digest('hex')
      const priorCookieName = getGenerationCookieName('prior-sess-1', 2)
      const presentedCookies = { [priorCookieName]: priorSecret }

      // CAS updateMany succeeds because possession proof (hash) and generation match
      prisma.authSession.updateMany.mockResolvedValue({ count: 1 })
      prisma.authSession.create.mockResolvedValue({})

      const result = await service.login('tutor0@miyura.com', 'yura1234', presentedCookies)

      expect(result.prunedCookieNames).toContain(priorCookieName)
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'prior-sess-1',
          generation: 2,
          refreshTokenHash: priorHash,
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      })
    })

    it('forged cookie cannot revoke unrelated active session without possession proof', async () => {
      const passwordHash = await bcrypt.hash('yura1234', 10)
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'tutor0@miyura.com',
        password: passwordHash,
        fullName: 'Tutor 0',
        role: 'TUTOR',
        companyId: null,
      })

      const attackerGuess = 'forged-secret-does-not-match'
      const targetCookieName = getGenerationCookieName('victim-sess-99', 1)
      const presentedCookies = { [targetCookieName]: attackerGuess }

      // Hash does not match stored DB hash -> 0 rows updated
      prisma.authSession.updateMany.mockResolvedValue({ count: 0 })
      // Active victim session exists and is unexpired
      prisma.authSession.findUnique.mockResolvedValue({
        id: 'victim-sess-99',
        generation: 1,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60000),
      })
      prisma.authSession.create.mockResolvedValue({})

      const result = await service.login('tutor0@miyura.com', 'yura1234', presentedCookies)

      // Must NOT prune victim session cookie or revoke it
      expect(result.prunedCookieNames).not.toContain(targetCookieName)
    })

    it('prunes stale generation cookie without revoking active newer generation in DB', async () => {
      const passwordHash = await bcrypt.hash('yura1234', 10)
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'tutor0@miyura.com',
        password: passwordHash,
        fullName: 'Tutor 0',
        role: 'TUTOR',
        companyId: null,
      })

      // Browser presents stale generation 1 cookie
      const staleCookieName = getGenerationCookieName('active-sess-1', 1)
      const presentedCookies = { [staleCookieName]: 'stale-secret-from-g1' }

      // CAS updateMany for gen 1 returns 0 because session is already at gen 2 in DB
      prisma.authSession.updateMany.mockResolvedValue({ count: 0 })
      // Active session in DB is at generation 2 and unrevoked
      prisma.authSession.findUnique.mockResolvedValue({
        id: 'active-sess-1',
        generation: 2,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 604800000),
      })
      prisma.authSession.create.mockResolvedValue({})

      const result = await service.login('tutor0@miyura.com', 'yura1234', presentedCookies)

      // Stale cookie name should be safely pruned
      expect(result.prunedCookieNames).toContain(staleCookieName)
      // Active session at generation 2 was NOT revoked
      expect(prisma.authSession.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { revokedAt: expect.any(Date) },
          where: expect.objectContaining({ generation: 2 }),
        }),
      )
    })

    it('repeated account changes successively retire presented prior valid sessions', async () => {
      const passwordHash = await bcrypt.hash('password123', 10)
      prisma.user.findUnique.mockImplementation(({ where }: { where: { email: string } }) => {
        return Promise.resolve({
          id: where.email === 'user1@test.com' ? 1 : where.email === 'user2@test.com' ? 2 : 3,
          email: where.email,
          password: passwordHash,
          fullName: 'Test User',
          role: 'STUDENT',
          companyId: null,
        })
      })

      // Step 1: User 1 logs in (no prior cookies)
      prisma.authSession.create.mockResolvedValue({})
      const login1 = await service.login('user1@test.com', 'password123')
      expect(login1.prunedCookieNames).toEqual([])
      const cookie1Name = getGenerationCookieName(login1.sessionId, login1.generation)

      // Step 2: User 2 logs in presenting User 1's cookie with valid possession proof
      const cookie1Hash = crypto.createHash('sha256').update(login1.refreshTokenSecret).digest('hex')
      prisma.authSession.updateMany.mockResolvedValue({ count: 1 })
      const login2 = await service.login('user2@test.com', 'password123', {
        [cookie1Name]: login1.refreshTokenSecret,
      })
      expect(login2.prunedCookieNames).toContain(cookie1Name)
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: login1.sessionId,
          generation: login1.generation,
          refreshTokenHash: cookie1Hash,
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      })
      const cookie2Name = getGenerationCookieName(login2.sessionId, login2.generation)

      // Step 3: User 3 logs in presenting User 2's cookie with valid possession proof
      const cookie2Hash = crypto.createHash('sha256').update(login2.refreshTokenSecret).digest('hex')
      prisma.authSession.updateMany.mockClear()
      prisma.authSession.updateMany.mockResolvedValue({ count: 1 })
      const login3 = await service.login('user3@test.com', 'password123', {
        [cookie2Name]: login2.refreshTokenSecret,
      })
      expect(login3.prunedCookieNames).toContain(cookie2Name)
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: login2.sessionId,
          generation: login2.generation,
          refreshTokenHash: cookie2Hash,
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      })
    })

    it('rejects login and performs no partial creation or revocation when cookies exceed limit', async () => {
      const passwordHash = await bcrypt.hash('yura1234', 10)
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'tutor0@miyura.com',
        password: passwordHash,
        fullName: 'Tutor 0',
        role: 'TUTOR',
        companyId: null,
      })

      const floodCookies: Record<string, string> = {}
      for (let i = 0; i < 15; i++) {
        floodCookies[getGenerationCookieName(`flood-${i}`, 1)] = 'secret'
      }

      await expect(service.login('tutor0@miyura.com', 'yura1234', floodCookies)).rejects.toThrow(
        'demasiadas cookies de autenticación presentadas',
      )

      // Must NOT create new session or attempt any revocation
      expect(prisma.authSession.create).not.toHaveBeenCalled()
      expect(prisma.authSession.updateMany).not.toHaveBeenCalled()
    })

    it('response expiresAt corresponds exactly to JWT exp in milliseconds without subsecond drift', async () => {
      const passwordHash = await bcrypt.hash('yura1234', 10)
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'tutor0@miyura.com',
        password: passwordHash,
        fullName: 'Tutor 0',
        role: 'TUTOR',
        companyId: null,
      })
      prisma.authSession.create.mockResolvedValue({})

      const result = await service.login('tutor0@miyura.com', 'yura1234')

      const decoded = (await jwtService.verifyAsync(result.accessToken)) as { exp: number }
      expect(decoded.exp).toBeDefined()
      // Exactly matches exp * 1000 with 000 milliseconds
      expect(result.expiresAt).toBe(decoded.exp * 1000)
      expect(result.expiresAt % 1000).toBe(0)
    })
  })

  describe('JWT real expiration & fake timers', () => {
    it('verifies real JWT exp rejection with fake clock', async () => {
      vi.useFakeTimers()
      const now = new Date('2026-10-05T12:00:00Z')
      vi.setSystemTime(now)

      const token = await jwtService.signAsync(
        { sub: 1, sessionId: 's1', generation: 1 },
        { expiresIn: 900 },
      )

      // At 14m, token is valid
      vi.advanceTimersByTime(14 * 60 * 1000)
      const valid = await jwtService.verifyAsync(token)
      expect(valid.sessionId).toBe('s1')

      // At 16m, token is expired
      vi.advanceTimersByTime(2 * 60 * 1000)
      await expect(jwtService.verifyAsync(token)).rejects.toThrow()
    })

    it('rejects renewal when access token is already expired (explicit renewal requirement)', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))

      const token = await jwtService.signAsync(
        { sub: 1, email: 'tutor@test.com', role: 'TUTOR', sessionId: 's1', generation: 1 },
        { expiresIn: 900 },
      )

      // Advance clock past expiration
      vi.advanceTimersByTime(16 * 60 * 1000)

      const cookieName = getGenerationCookieName('s1', 1)
      const cookies = { [cookieName]: 'raw-secret' }

      await expect(service.refresh(token, cookies)).rejects.toThrow(
        'token de acceso inválido o expirado',
      )
    })
  })

  describe('refresh & race safety', () => {
    it('atomically advances generation and rotates secret on valid refresh', async () => {
      const sessionId = 's1-uuid'
      const token = await jwtService.signAsync(
        { sub: 1, email: 'tutor@test.com', role: 'TUTOR', sessionId, generation: 1 },
        { expiresIn: 900 },
      )

      const rawSecret = 'initial-secret-1234'
      const cookieName = getGenerationCookieName(sessionId, 1)
      const cookies = { [cookieName]: rawSecret }

      prisma.authSession.updateMany.mockResolvedValue({ count: 1 })
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'tutor@test.com',
        fullName: 'Tutor Test',
        role: 'TUTOR',
        companyId: null,
      })

      const res = await service.refresh(token, cookies)

      expect(res.generation).toBe(2)
      expect(res.sessionId).toBe(sessionId)
      expect(res.oldCookieName).toBe(cookieName)
      expect(res.refreshTokenSecret).not.toBe(rawSecret)

      const decoded = await jwtService.verifyAsync(res.accessToken)
      expect(decoded.generation).toBe(2)

      // Confirms DB CAS updateMany had correct where conditions
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: sessionId,
          userId: 1,
          generation: 1,
          refreshTokenHash: crypto.createHash('sha256').update(rawSecret).digest('hex'),
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: {
          generation: 2,
          refreshTokenHash: expect.any(String),
          updatedAt: expect.any(Date),
        },
      })
    })

    it('rejects stale replay without destroying active newer session (no DoS)', async () => {
      const sessionId = 's1-uuid'
      const staleToken = await jwtService.signAsync(
        { sub: 1, email: 'tutor@test.com', role: 'TUTOR', sessionId, generation: 1 },
        { expiresIn: 900 },
      )

      const cookies = { [getGenerationCookieName(sessionId, 1)]: 'stale-secret' }

      // CAS updateMany returns 0 because session in DB has already advanced to generation 2
      prisma.authSession.updateMany.mockResolvedValue({ count: 0 })
      // Active session in DB is at generation 2 and not revoked
      prisma.authSession.findUnique.mockResolvedValue({
        id: sessionId,
        generation: 2,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
      })

      await expect(service.refresh(staleToken, cookies)).rejects.toThrow(
        'solicitud de renovación inválida o ya procesada',
      )

      // Confirm no subsequent updateMany revoked the active session
      expect(prisma.authSession.updateMany).toHaveBeenCalledTimes(1)
    })

    it('rejects renewal when session has exceeded absolute renewal expiry', async () => {
      const sessionId = 's1-uuid'
      const token = await jwtService.signAsync(
        { sub: 1, email: 'tutor@test.com', role: 'TUTOR', sessionId, generation: 1 },
        { expiresIn: 900 },
      )

      const cookies = { [getGenerationCookieName(sessionId, 1)]: 'secret' }

      prisma.authSession.updateMany.mockResolvedValue({ count: 0 })
      // Session in DB has expired absolute lifetime
      prisma.authSession.findUnique.mockResolvedValue({
        id: sessionId,
        generation: 1,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000), // in the past
      })

      await expect(service.refresh(token, cookies)).rejects.toThrow('sesión inválida o expirada')
    })
  })

  describe('logout', () => {
    it('revokes session for expired access token if signature is valid', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))

      const sessionId = 'logout-sess-1'
      const token = await jwtService.signAsync(
        { sub: 1, sessionId, generation: 3 },
        { expiresIn: 900 },
      )

      // Advance clock past expiration
      vi.advanceTimersByTime(30 * 60 * 1000)

      prisma.authSession.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.logout(token)

      expect(result.sessionId).toBe(sessionId)
      expect(result.generation).toBe(3)
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: { id: sessionId, userId: 1, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      })
    })

    it('rejects logout with forged token signature', async () => {
      const forgedToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsInNlc3Npb25JZCI6InMtMSIsImdlbmVyYXRpb24iOjF9.invalid_signature'

      await expect(service.logout(forgedToken)).rejects.toThrow('token inválido')
    })

    it('rejects logout with signed token missing mandatory exp', async () => {
      const bareJwt = new JwtService({ secret: testSecret })
      const tokenWithoutExp = await bareJwt.signAsync({
        sub: 1,
        sessionId: 'logout-sess-1',
        generation: 3,
      })

      await expect(service.logout(tokenWithoutExp)).rejects.toThrow('token sin identificadores de sesión válidos')
    })
  })
})
