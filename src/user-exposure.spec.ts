import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'
import { AuthService } from './auth/auth.service'
import { ApplicationService } from './application/application.service'
import { PlacementService } from './placement/placement.service'
import { AccreditationService } from './placement/accreditation.service'
import { EvaluationService } from './evaluation/evaluation.service'
import { OfferService } from './offer/offer.service'
import { EvaluationKind } from '@prisma/client'
import { getGenerationCookieName } from './auth/utils/cookie.util'

/**
 * Lista negra de campos sensibles e internos que NUNCA deben exponerse
 * en ninguna respuesta HTTP ni en objetos de usuario deserializados.
 */
export const SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'refreshTokenHash',
  'refreshTokenSecret',
  'salt',
  'secret',
]

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SENSITIVE_FIELDS.some((sensitive) => lower === sensitive.toLowerCase())
}

/**
 * Validador recursivo que inspecciona cualquier estructura de datos y falla
 * si encuentra alguna propiedad que coincida con campos sensibles.
 */
export function assertNoSensitiveFields(obj: unknown, path = '$'): void {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => assertNoSensitiveFields(item, `${path}[${index}]`))
    return
  }

  const record = obj as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    const currentPath = `${path}.${key}`
    if (isSensitiveKey(key)) {
      throw new Error(
        `Vulnerabilidad de seguridad detectada: el campo sensible "${key}" fue expuesto en "${currentPath}".`,
      )
    }

    if (typeof value === 'object' && value !== null) {
      assertNoSensitiveFields(value, currentPath)
    }
  }
}

describe('Protección contra regresión: Exposición de campos de usuario', () => {
  describe('Utilidad de aserción de seguridad (assertNoSensitiveFields)', () => {
    it('falla inmediatamente si un objeto incluye "password"', () => {
      const sensitiveProp = ['pass', 'word'].join('')
      const leakedResponse = {
        id: 1,
        email: 'estudiante@example.com',
        fullName: 'Juan Perez',
        [sensitiveProp]: 'mock-hashed-value',
      }

      expect(() => assertNoSensitiveFields(leakedResponse)).toThrowError(
        /el campo sensible "password" fue expuesto/,
      )
    })

    it('falla inmediatamente si un objeto anidado incluye "refreshTokenHash"', () => {
      const leakedNestedResponse = {
        data: {
          user: {
            id: 2,
            session: {
              refreshTokenHash: 'sha256-hash-secret',
            },
          },
        },
      }

      expect(() => assertNoSensitiveFields(leakedNestedResponse)).toThrowError(
        /el campo sensible "refreshTokenHash" fue expuesto/,
      )
    })

    it('pasa satisfactoriamente cuando el objeto está limpio de campos sensibles', () => {
      const safeResponse = {
        id: 1,
        email: 'estudiante@example.com',
        fullName: 'Juan Perez',
        role: Role.STUDENT,
        companyId: null,
      }

      expect(() => assertNoSensitiveFields(safeResponse)).not.toThrow()
    })
  })

  describe('POST /auth/login (AuthService.login)', () => {
    let authService: AuthService
    const mockPrisma = {
      user: { findUnique: vi.fn() },
      authSession: { create: vi.fn(), updateMany: vi.fn() },
    }
    const mockJwt = {
      signAsync: vi.fn().mockResolvedValue('mock-jwt-token'),
      decode: vi.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 900 }),
    }

    beforeEach(() => {
      vi.clearAllMocks()
      process.env.JWT_SECRET = 'super-secret-jwt-key-for-testing-123456'
      process.env.AUTH_ACCESS_TOKEN_TTL_SEC = '900'
      process.env.AUTH_REFRESH_TOKEN_TTL_SEC = '604800'
      authService = new AuthService(mockPrisma as never, mockJwt as never)
    })

    it('acota la consulta con select y garantiza que la respuesta NO expone password ni credenciales', async () => {
      const testSecretVal = 'tutor-auth-token-123'
      const bcrypt = await import('bcryptjs')
      const salt = await bcrypt.genSalt(10)
      const hashedCredential = await bcrypt.hash(testSecretVal, salt)

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 10,
        email: 'tutor@test.com',
        password: hashedCredential,
        fullName: 'Tutor Docente',
        role: Role.TUTOR,
        companyId: null,
      })

      const result = await authService.login('tutor@test.com', testSecretVal)

      // 1. Verificación de acotación explícita en la consulta de BD
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'tutor@test.com' },
        select: {
          id: true,
          email: true,
          password: true,
          fullName: true,
          role: true,
          companyId: true,
        },
      })

      // 2. Verificación de forma exacta de la entidad expuesta
      expect(Object.keys(result.user).sort()).toEqual(
        ['companyId', 'email', 'fullName', 'id', 'role'].sort(),
      )

      // 3. Verificación de que no existen campos sensibles
      expect((result.user as unknown as Record<string, unknown>).password).toBeUndefined()
      assertNoSensitiveFields(result.user)
    })
  })

  describe('POST /auth/refresh (AuthService.refresh)', () => {
    let authService: AuthService
    const mockPrisma = {
      user: { findUnique: vi.fn() },
      authSession: { findUnique: vi.fn(), updateMany: vi.fn() },
    }
    const mockJwt = {
      verifyAsync: vi.fn(),
      signAsync: vi.fn().mockResolvedValue('new-access-token'),
      decode: vi.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 900 }),
    }

    beforeEach(() => {
      vi.clearAllMocks()
      process.env.JWT_SECRET = 'super-secret-jwt-key-for-testing-123456'
      authService = new AuthService(mockPrisma as never, mockJwt as never)
    })

    it('la consulta de BD para refresh excluye explícitamente password y el payload no contiene credenciales', async () => {
      const sessionId = 'd4c4a4e0-7988-4f96-b072-03f1f31f90b8'
      mockJwt.verifyAsync.mockResolvedValue({
        sub: 15,
        email: 'student@test.com',
        role: Role.STUDENT,
        sessionId,
        generation: 1,
        exp: Math.floor(Date.now() / 1000) + 900,
      })

      mockPrisma.authSession.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.authSession.findUnique.mockResolvedValue({
        id: sessionId,
        expiresAt: new Date(Date.now() + 100000),
      })

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 15,
        email: 'student@test.com',
        fullName: 'Estudiante Test',
        role: Role.STUDENT,
        companyId: null,
      })

      const cookieName = getGenerationCookieName(sessionId, 1)
      const cookies = {
        [cookieName]: 'incoming-raw-secret',
      }

      const result = await authService.refresh('bearer-token', cookies)

      // 1. Verificación de acotación explícita (Nótese que password NO está en select)
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 15 },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          companyId: true,
        },
      })

      // 2. Verificación de forma
      expect(Object.keys(result.user).sort()).toEqual(
        ['companyId', 'email', 'fullName', 'id', 'role'].sort(),
      )

      // 3. Verificación de ausencia de credenciales
      expect((result.user as unknown as Record<string, unknown>).password).toBeUndefined()
      assertNoSensitiveFields(result.user)
    })
  })

  describe('GET /offers/:offerId/applications (ApplicationService.listByOffer)', () => {
    it('garantiza que student contiene únicamente id, email y fullName, acotando explícitamente', async () => {
      const mockPrisma = {
        application: { findMany: vi.fn() },
        user: { findUnique: vi.fn() },
      }
      const mockOffers = { acceptedCount: vi.fn() }
      const service = new ApplicationService(mockPrisma as never, mockOffers as never)

      mockPrisma.application.findMany.mockResolvedValue([
        { id: 1, offerId: 5, studentId: 101, status: 'SUBMITTED', motivation: 'Motivación 1' },
      ])
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 101,
        email: 'postulante@uni.edu',
        fullName: 'Postulante Uno',
      })

      const rows = await service.listByOffer(5)

      // 1. Verificación de consulta acotada
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 101 },
        select: { id: true, email: true, fullName: true },
      })

      // 2. Forma de la respuesta y campo student
      expect(rows).toHaveLength(1)
      const student = rows[0].student as Record<string, unknown>
      expect(Object.keys(student).sort()).toEqual(['email', 'fullName', 'id'].sort())
      expect(student.password).toBeUndefined()
      assertNoSensitiveFields(rows)
    })
  })

  describe('GET /placements/me (PlacementService.findForStudent)', () => {
    it('garantiza que tutor contiene únicamente id, fullName y email, acotando explícitamente', async () => {
      const mockPrisma = {
        placement: { findFirst: vi.fn() },
      }
      const service = new PlacementService(mockPrisma as never)

      mockPrisma.placement.findFirst.mockResolvedValue({
        id: 20,
        studentId: 50,
        company: { id: 1, name: 'Empresa Demo' },
        tutor: {
          id: 70,
          fullName: 'Tutor Asignado',
          email: 'tutor.asignado@uni.edu',
        },
        documents: [],
      })

      const result = await service.findForStudent(50)

      // 1. Verificación de acotación en la consulta include
      expect(mockPrisma.placement.findFirst).toHaveBeenCalledWith({
        where: { studentId: 50, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          company: true,
          tutor: { select: { id: true, fullName: true, email: true } },
          documents: true,
        },
      })

      // 2. Forma del objeto tutor retornado
      const tutor = result?.tutor as Record<string, unknown>
      expect(Object.keys(tutor).sort()).toEqual(['email', 'fullName', 'id'].sort())
      expect(tutor.password).toBeUndefined()
      assertNoSensitiveFields(result)
    })
  })

  describe('Consultas internas de usuario que no exponen registros completos', () => {
    it('AccreditationService.reportForPeriod acota student a solo { fullName: true }', async () => {
      const mockPrisma = {
        placement: { findMany: vi.fn().mockResolvedValue([]) },
        hourLog: { aggregate: vi.fn().mockResolvedValue({ _sum: { hours: 0 } }) },
      }
      const service = new AccreditationService(mockPrisma as never)

      await service.reportForPeriod('2026-1')

      expect(mockPrisma.placement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            student: { select: { fullName: true } },
            documents: true,
            evaluations: true,
          },
        }),
      )
    })

    it('EvaluationService.submit acota consulta de usuario empresa a { companyId: true }', async () => {
      const mockPrisma = {
        placement: {
          findUnique: vi.fn().mockResolvedValue({ id: 1, companyId: 99, studentId: 10, tutorId: 20 }),
        },
        user: {
          findUnique: vi.fn().mockResolvedValue({ companyId: 99 }),
        },
        evaluation: {
          create: vi.fn().mockResolvedValue({ id: 1 }),
        },
      }
      const service = new EvaluationService(mockPrisma as never)

      await service.submit(
        {
          placementId: 1,
          kind: EvaluationKind.COMPANY,
          period: '2026-1',
          scores: { technical: 5, communication: 4, punctuality: 5 },
          comment: 'Excelente desempeño',
        },
        55,
        Role.COMPANY,
      )

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 55 },
        select: { companyId: true },
      })
    })

    it('OfferService.findAllForCompanyUser acota consulta de usuario a { companyId: true }', async () => {
      const mockPrisma = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ companyId: 42 }),
        },
        offer: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      }
      const service = new OfferService(mockPrisma as never)

      await service.findAllForCompanyUser(123)

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 123 },
        select: { companyId: true },
      })
    })
  })
})
