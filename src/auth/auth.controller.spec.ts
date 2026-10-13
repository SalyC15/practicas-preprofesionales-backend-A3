import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthConfig } from './auth.config'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { getGenerationCookieName } from './utils/cookie.util'

describe('AuthController', () => {
  let controller: AuthController
  let authService: {
    login: any
    refresh: any
    logout: any
  }

  beforeEach(async () => {
    process.env.CORS_ORIGIN = 'http://localhost:5173'
    process.env.NODE_ENV = 'test'

    authService = {
      login: vi.fn(),
      refresh: vi.fn(),
      logout: vi.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile()

    controller = moduleRef.get<AuthController>(AuthController)
  })

  function mockReqRes(headers: Record<string, string> = {}) {
    const cookiesSet: Record<string, { val: string; opts: any }> = {}
    const cookiesCleared: Record<string, any> = {}

    const req: any = {
      headers: { ...headers },
    }

    const res: any = {
      cookie: vi.fn((name, val, opts) => {
        cookiesSet[name] = { val, opts }
      }),
      clearCookie: vi.fn((name, opts) => {
        cookiesCleared[name] = opts
      }),
    }

    return { req, res, cookiesSet, cookiesCleared }
  }

  describe('login', () => {
    it('sets generation-specific cookie and returns frontend payload', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'access-123',
        expiresAt: 1743859200000,
        user: { id: 1, email: 'tutor@miyura.com', fullName: 'Tutor', role: 'TUTOR', companyId: null },
        sessionId: 's-10',
        generation: 1,
        refreshTokenSecret: 'secret-xyz',
        refreshExpiresAt: new Date(Date.now() + 604800000),
        prunedCookieNames: ['rt_old_g1'],
      })

      const { req, res, cookiesSet, cookiesCleared } = mockReqRes({
        origin: 'http://localhost:5173',
      })

      const result = await controller.login(
        { email: 'tutor@miyura.com', password: 'password123' },
        res,
        req,
      )

      expect(result).toEqual({
        accessToken: 'access-123',
        expiresAt: 1743859200000,
        user: { id: 1, email: 'tutor@miyura.com', fullName: 'Tutor', role: 'TUTOR', companyId: null },
      })
      expect(result).not.toHaveProperty('refreshTokenSecret')
      expect(cookiesCleared['rt_old_g1']).toBeDefined()
      expect(cookiesSet['rt_s-10_g1']).toBeDefined()
      expect(cookiesSet['rt_s-10_g1'].val).toBe('secret-xyz')
      expect(cookiesSet['rt_s-10_g1'].opts.httpOnly).toBe(true)
    })

    it('rejects login with untrusted origin', async () => {
      const { req, res } = mockReqRes({
        origin: 'http://malicious-site.com',
      })

      await expect(
        controller.login({ email: 'tutor@miyura.com', password: 'pwd' }, res, req),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('refresh', () => {
    it('extracts bearer and cookie, rotates generation cookie, and clears old cookie', async () => {
      const sessionId = 's-10'
      const oldCookie = getGenerationCookieName(sessionId, 1)
      const newCookie = getGenerationCookieName(sessionId, 2)

      authService.refresh.mockResolvedValue({
        accessToken: 'access-456',
        expiresAt: 1743859900000,
        user: { id: 1, email: 'tutor@miyura.com', fullName: 'Tutor', role: 'TUTOR', companyId: null },
        sessionId,
        generation: 2,
        refreshTokenSecret: 'secret-new',
        refreshExpiresAt: new Date(Date.now() + 300000), // 300s remaining
        oldCookieName: oldCookie,
      })

      const { req, res, cookiesSet, cookiesCleared } = mockReqRes({
        origin: 'http://localhost:5173',
        authorization: 'Bearer valid-access-token',
        cookie: `${oldCookie}=secret-old`,
      })

      const result = await controller.refresh(req, res)

      expect(result.accessToken).toBe('access-456')
      expect(cookiesCleared[oldCookie]).toBeDefined()
      expect(cookiesSet[newCookie]).toBeDefined()
      expect(cookiesSet[newCookie].val).toBe('secret-new')
      // Remaining absolute session expiry is used, NOT resetting to 7 days (604800s)
      expect(cookiesSet[newCookie].opts.maxAge).toBe(300 * 1000)
    })

    it('delayed response snapshot clears only old key without wildcard or deleting newer keys', async () => {
      const sessionId = 's-10'
      const oldCookie = getGenerationCookieName(sessionId, 1)
      const newCookie = getGenerationCookieName(sessionId, 2)

      authService.refresh.mockResolvedValue({
        accessToken: 'access-789',
        expiresAt: 1743860000000,
        user: { id: 1, email: 'tutor@miyura.com', fullName: 'Tutor', role: 'TUTOR', companyId: null },
        sessionId,
        generation: 2,
        refreshTokenSecret: 'secret-2',
        refreshExpiresAt: new Date(Date.now() + 500000),
        oldCookieName: oldCookie,
      })

      const { req, res, cookiesSet, cookiesCleared } = mockReqRes({
        origin: 'http://localhost:5173',
        authorization: 'Bearer valid-access-token',
        cookie: `${oldCookie}=secret-1`,
      })

      await controller.refresh(req, res)

      // Only oldCookie was cleared; newCookie was set, not cleared
      expect(cookiesCleared[oldCookie]).toBeDefined()
      expect(cookiesCleared[newCookie]).toBeUndefined()
      expect(cookiesSet[newCookie]).toBeDefined()
    })

    it('rejects refresh when authorization header is missing', async () => {
      const { req, res } = mockReqRes({
        origin: 'http://localhost:5173',
      })

      await expect(controller.refresh(req, res)).rejects.toThrow('falta el token de acceso')
    })
  })

  describe('logout', () => {
    it('revokes session and clears targeted cookie returning 204', async () => {
      const sessionId = 's-10'
      authService.logout.mockResolvedValue({
        sessionId,
        generation: 2,
      })

      const cookieName = getGenerationCookieName(sessionId, 2)
      const { req, res, cookiesCleared } = mockReqRes({
        origin: 'http://localhost:5173',
        authorization: 'Bearer expired-but-signed-token',
        cookie: `${cookieName}=secret`,
      })

      await controller.logout(req, res)

      expect(cookiesCleared[cookieName]).toBeDefined()
      expect(authService.logout).toHaveBeenCalledWith('expired-but-signed-token')
    })

    it('clears only targeted session cookies, leaving independent browser session cookies untouched', async () => {
      const sessionId = 's-10'
      const independentSessionId = 'independent-sess-99'
      authService.logout.mockResolvedValue({
        sessionId,
        generation: 2,
      })

      const targetCookie = getGenerationCookieName(sessionId, 2)
      const independentCookie = getGenerationCookieName(independentSessionId, 1)

      const { req, res, cookiesCleared } = mockReqRes({
        origin: 'http://localhost:5173',
        authorization: 'Bearer valid-token',
        cookie: `${targetCookie}=sec1; ${independentCookie}=sec2`,
      })

      await controller.logout(req, res)

      // Only target session cookie was cleared
      expect(cookiesCleared[targetCookie]).toBeDefined()
      // Independent session cookie was NOT cleared
      expect(cookiesCleared[independentCookie]).toBeUndefined()
    })
  })

  describe('Referer origin security tests', () => {
    it('accepts valid referer with matching trusted origin and path', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'tok',
        expiresAt: 12345,
        user: { id: 1, email: 't@m.com', fullName: 'T', role: 'STUDENT', companyId: null },
        sessionId: 's',
        generation: 1,
        refreshTokenSecret: 'sec',
        refreshExpiresAt: new Date(Date.now() + 600000),
      })

      const { req, res } = mockReqRes({
        referer: 'http://localhost:5173/dashboard/profile?tab=1',
      })

      await expect(
        controller.login({ email: 't@m.com', password: 'pwd' }, res, req),
      ).resolves.toBeDefined()
    })

    it('rejects lookalike referer prefix https://trusted.example.attacker/', async () => {
      const { req, res } = mockReqRes({
        referer: 'http://localhost:5173.attacker.com/steal',
      })

      await expect(
        controller.login({ email: 't@m.com', password: 'pwd' }, res, req),
      ).rejects.toThrow(ForbiddenException)
    })

    it('rejects referer with embedded credentials trusted.example@attacker/', async () => {
      const { req, res } = mockReqRes({
        referer: 'http://localhost:5173@attacker.com/evil',
      })

      await expect(
        controller.login({ email: 't@m.com', password: 'pwd' }, res, req),
      ).rejects.toThrow(ForbiddenException)
    })

    it('rejects malformed referer on refresh', async () => {
      const { req, res } = mockReqRes({
        referer: 'not_a_valid_url',
        authorization: 'Bearer token',
      })

      await expect(controller.refresh(req, res)).rejects.toThrow(ForbiddenException)
    })

    it('rejects untrusted referer on logout', async () => {
      const { req, res } = mockReqRes({
        referer: 'https://evil.org/logout-attempt',
        authorization: 'Bearer token',
      })

      await expect(controller.logout(req, res)).rejects.toThrow(ForbiddenException)
    })
  })
})
