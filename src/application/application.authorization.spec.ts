import { randomUUID } from 'node:crypto'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { ApplicationStatus, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module'
import { HttpExceptionFilter } from '../common/http-exception.filter'
import { PrismaService } from '../prisma/prisma.service'

describe('E3-07: Impedir que una empresa ajena liste o decida postulaciones de otra empresa', () => {
  let app: INestApplication
  let baseUrl: string
  let prisma: PrismaService
  let dbAvailable = false

  let companyAId = 1
  let companyBId = 2
  let companyUserAId = 10
  let companyUserBId = 20
  let coordinatorId = 30
  let studentId = 40
  let offerAId = 100
  let applicationForOfferAId = 500
  let applicationForCoordDecisionId = 501

  let tokenCompanyA: string
  let tokenCompanyB: string
  let tokenCoordinator: string

  const appState = {
    app1Status: ApplicationStatus.SUBMITTED,
    app1DecidedAt: null as Date | null,
    app2Status: ApplicationStatus.SUBMITTED,
    app2DecidedAt: null as Date | null,
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'ci-secret-for-test-32-chars-long!!'
    process.env.CORS_ORIGIN = 'http://localhost:5173'

    if (process.env.DATABASE_URL) {
      try {
        prisma = new PrismaService()
        await prisma.onModuleInit()
        dbAvailable = true
      } catch {
        dbAvailable = false
      }
    } else {
      dbAvailable = false
    }

    if (dbAvailable) {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile()

      app = moduleRef.createNestApplication()
      app.setGlobalPrefix('api')
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      app.useGlobalFilters(new HttpExceptionFilter())
      await app.init()
      await app.listen(0)

      const serverAddress = app.getHttpServer().address()
      const port = typeof serverAddress === 'string' ? 3000 : serverAddress.port
      baseUrl = `http://localhost:${port}/api`

      const suffix = randomUUID().slice(0, 8)
      const userSecret = ['test', 'secret', 'pass', suffix].join('-')
      const passwordHash = await bcrypt.hash(userSecret, 10)

      const companyA = await prisma.company.create({
        data: {
          taxId: `TAX-A-${suffix}`,
          name: `Empresa Dueña ${suffix}`,
          sector: 'Tecnología',
          contactEmail: `empresa-a-${suffix}@test.com`,
        },
      })
      companyAId = companyA.id

      const companyB = await prisma.company.create({
        data: {
          taxId: `TAX-B-${suffix}`,
          name: `Empresa Ajena ${suffix}`,
          sector: 'Comercio',
          contactEmail: `empresa-b-${suffix}@test.com`,
        },
      })
      companyBId = companyB.id

      const companyUserA = await prisma.user.create({
        data: {
          email: `company-a-${suffix}@test.com`,
          password: passwordHash,
          fullName: `Usuario Empresa A ${suffix}`,
          role: Role.COMPANY,
          companyId: companyAId,
        },
      })
      companyUserAId = companyUserA.id

      const companyUserB = await prisma.user.create({
        data: {
          email: `company-b-${suffix}@test.com`,
          password: passwordHash,
          fullName: `Usuario Empresa B ${suffix}`,
          role: Role.COMPANY,
          companyId: companyBId,
        },
      })
      companyUserBId = companyUserB.id

      const coordinator = await prisma.user.create({
        data: {
          email: `coordinator-${suffix}@test.com`,
          password: passwordHash,
          fullName: `Coordinador Académico ${suffix}`,
          role: Role.COORDINATOR,
        },
      })
      coordinatorId = coordinator.id

      const student = await prisma.user.create({
        data: {
          email: `student-${suffix}@test.com`,
          password: passwordHash,
          fullName: `Estudiante Postulante ${suffix}`,
          role: Role.STUDENT,
        },
      })
      studentId = student.id

      const offerA = await prisma.offer.create({
        data: {
          companyId: companyAId,
          title: `Desarrollador Full Stack ${suffix}`,
          description: 'Prácticas en desarrollo web',
          modality: 'HIBRIDO',
          seats: 3,
          requiredHours: 240,
          periodStart: new Date('2026-02-01'),
          periodEnd: new Date('2026-08-01'),
        },
      })
      offerAId = offerA.id

      const app1 = await prisma.application.create({
        data: {
          offerId: offerAId,
          studentId,
          motivation: 'Interés en desarrollo backend',
          status: ApplicationStatus.SUBMITTED,
        },
      })
      applicationForOfferAId = app1.id

      const student2 = await prisma.user.create({
        data: {
          email: `student2-${suffix}@test.com`,
          password: passwordHash,
          fullName: `Estudiante 2 ${suffix}`,
          role: Role.STUDENT,
        },
      })
      const app2 = await prisma.application.create({
        data: {
          offerId: offerAId,
          studentId: student2.id,
          motivation: 'Interés en arquitectura de software',
          status: ApplicationStatus.SUBMITTED,
        },
      })
      applicationForCoordDecisionId = app2.id

      async function login(email: string) {
        const res = await fetch(`${baseUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: userSecret }),
        })
        const data = (await res.json()) as { accessToken: string }
        return data.accessToken
      }

      tokenCompanyA = await login(companyUserA.email)
      tokenCompanyB = await login(companyUserB.email)
      tokenCoordinator = await login(coordinator.email)
    } else {
      // Mock de PrismaService para ejecutar el servidor HTTP completo con JwtAuthGuard y RolesGuard
      const mockPrisma = {
        $connect: vi.fn(),
        $disconnect: vi.fn(),
        onModuleInit: vi.fn(),
        authSession: {
          findUnique: vi.fn().mockImplementation(({ where }) => {
            let userId = coordinatorId
            if (where.id === 'sess-company-a') {
              userId = companyUserAId
            } else if (where.id === 'sess-company-b') {
              userId = companyUserBId
            }
            return Promise.resolve({
              id: where.id,
              userId,
              generation: 1,
              revokedAt: null,
              expiresAt: new Date(Date.now() + 3600000),
            })
          }),
        },
        user: {
          findUnique: vi.fn().mockImplementation(({ where }) => {
            if (where.id === companyUserAId) {
              return Promise.resolve({ id: companyUserAId, email: 'company-a@test.com', role: Role.COMPANY, companyId: companyAId })
            }
            if (where.id === companyUserBId) {
              return Promise.resolve({ id: companyUserBId, email: 'company-b@test.com', role: Role.COMPANY, companyId: companyBId })
            }
            if (where.id === coordinatorId) {
              return Promise.resolve({ id: coordinatorId, email: 'coord@test.com', role: Role.COORDINATOR, companyId: null })
            }
            if (where.id === studentId) {
              return Promise.resolve({ id: studentId, email: 'student@test.com', fullName: 'Estudiante', role: Role.STUDENT })
            }
            return Promise.resolve(null)
          }),
        },
        offer: {
          findUnique: vi.fn().mockImplementation(({ where }) => {
            if (where.id === offerAId) {
              return Promise.resolve({ id: offerAId, companyId: companyAId, seats: 3, status: 'PUBLISHED' })
            }
            return Promise.resolve(null)
          }),
        },
        application: {
          findUnique: vi.fn().mockImplementation(({ where }) => {
            if (where.id === applicationForOfferAId) {
              return Promise.resolve({
                id: applicationForOfferAId,
                offerId: offerAId,
                studentId,
                status: appState.app1Status,
                decidedAt: appState.app1DecidedAt,
              })
            }
            if (where.id === applicationForCoordDecisionId) {
              return Promise.resolve({
                id: applicationForCoordDecisionId,
                offerId: offerAId,
                studentId,
                status: appState.app2Status,
                decidedAt: appState.app2DecidedAt,
              })
            }
            return Promise.resolve(null)
          }),
          findMany: vi.fn().mockImplementation(({ where }) => {
            if (where.offerId === offerAId) {
              return Promise.resolve([
                { id: applicationForOfferAId, offerId: offerAId, studentId, status: appState.app1Status },
              ])
            }
            return Promise.resolve([])
          }),
          update: vi.fn().mockImplementation(({ where, data }) => {
            if (where.id === applicationForOfferAId) {
              appState.app1Status = data.status
              appState.app1DecidedAt = data.decidedAt
              return Promise.resolve({ id: applicationForOfferAId, status: data.status, decidedAt: data.decidedAt })
            }
            if (where.id === applicationForCoordDecisionId) {
              appState.app2Status = data.status
              appState.app2DecidedAt = data.decidedAt
              return Promise.resolve({ id: applicationForCoordDecisionId, status: data.status, decidedAt: data.decidedAt })
            }
            return Promise.resolve({ id: where.id, ...data })
          }),
          count: vi.fn().mockResolvedValue(0),
        },
      }

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(mockPrisma)
        .compile()

      app = moduleRef.createNestApplication()
      app.setGlobalPrefix('api')
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      app.useGlobalFilters(new HttpExceptionFilter())
      await app.init()
      await app.listen(0)

      const serverAddress = app.getHttpServer().address()
      const port = typeof serverAddress === 'string' ? 3000 : serverAddress.port
      baseUrl = `http://localhost:${port}/api`

      const jwt = app.get(JwtService)
      tokenCompanyA = await jwt.signAsync({
        sub: companyUserAId,
        email: 'company-a@test.com',
        role: Role.COMPANY,
        sessionId: 'sess-company-a',
        generation: 1,
      })
      tokenCompanyB = await jwt.signAsync({
        sub: companyUserBId,
        email: 'company-b@test.com',
        role: Role.COMPANY,
        sessionId: 'sess-company-b',
        generation: 1,
      })
      tokenCoordinator = await jwt.signAsync({
        sub: coordinatorId,
        email: 'coord@test.com',
        role: Role.COORDINATOR,
        sessionId: 'sess-coord',
        generation: 1,
      })
    }
  })

  afterAll(async () => {
    try {
      if (dbAvailable && prisma) {
        await prisma.application.deleteMany({ where: { offerId: offerAId } })
        await prisma.offer.deleteMany({ where: { id: offerAId } })
        await prisma.authSession.deleteMany({
          where: {
            userId: { in: [companyUserAId, companyUserBId, coordinatorId, studentId] },
          },
        })
        await prisma.user.deleteMany({
          where: {
            email: { contains: 'test.com' },
          },
        })
        await prisma.company.deleteMany({ where: { id: { in: [companyAId, companyBId] } } })
      }
    } finally {
      if (app) await app.close()
      if (dbAvailable && prisma) await prisma.$disconnect()
    }
  })

  describe('Endpoint GET /offers/:offerId/applications (Listar postulaciones)', () => {
    it('el curl que antes devolvía 200 al listar postulaciones con una empresa ajena ahora devuelve 403 Forbidden', async () => {
      // Empresa B (ajena) intenta listar las postulaciones de la oferta de Empresa A
      const response = await fetch(`${baseUrl}/offers/${offerAId}/applications`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenCompanyB}`,
        },
      })

      expect(response.status).toBe(403)
      const body = (await response.json()) as { statusCode: number; message: string }
      expect(body.statusCode).toBe(403)
      expect(body.message).toMatch(/no tienes acceso a esta oferta|no tienes acceso/i)
    })

    it('la empresa dueña de la oferta sigue listando sus postulaciones con normalidad (200 OK)', async () => {
      // Empresa A (dueña) lista las postulaciones de su oferta
      const response = await fetch(`${baseUrl}/offers/${offerAId}/applications`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenCompanyA}`,
        },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as Array<{ id: number; offerId: number; student: unknown }>
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBeGreaterThanOrEqual(1)
      expect(body.some((item) => item.id === applicationForOfferAId)).toBe(true)
    })

    it('la coordinación conserva el acceso que ya tenía y puede listar postulaciones (200 OK)', async () => {
      // Coordinador consulta las postulaciones de la oferta de Empresa A
      const response = await fetch(`${baseUrl}/offers/${offerAId}/applications`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenCoordinator}`,
        },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as unknown[]
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Endpoint PATCH /applications/:id/decide (Decidir postulación)', () => {
    it('el curl que antes devolvía 200 al decidir una postulación con una empresa ajena ahora devuelve 403 Forbidden', async () => {
      // Empresa B (ajena) intenta decidir una postulación de la oferta de Empresa A
      const response = await fetch(`${baseUrl}/applications/${applicationForOfferAId}/decide`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenCompanyB}`,
        },
        body: JSON.stringify({
          status: 'ACCEPTED',
        }),
      })

      expect(response.status).toBe(403)
      const body = (await response.json()) as { statusCode: number; message: string }
      expect(body.statusCode).toBe(403)
      expect(body.message).toMatch(/no tienes acceso a esta oferta|no tienes acceso/i)

      if (dbAvailable && prisma) {
        // Verificar que en base de datos la postulación NO fue modificada y sigue en SUBMITTED
        const appInDb = await prisma.application.findUnique({ where: { id: applicationForOfferAId } })
        expect(appInDb?.status).toBe(ApplicationStatus.SUBMITTED)
        expect(appInDb?.decidedAt).toBeNull()
      } else {
        expect(appState.app1Status).toBe(ApplicationStatus.SUBMITTED)
        expect(appState.app1DecidedAt).toBeNull()
      }
    })

    it('la empresa dueña de la oferta sigue decidiendo con normalidad (200 OK)', async () => {
      // Empresa A (dueña) acepta la postulación
      const response = await fetch(`${baseUrl}/applications/${applicationForOfferAId}/decide`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenCompanyA}`,
        },
        body: JSON.stringify({
          status: 'ACCEPTED',
        }),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { id: number; status: string; decidedAt: string }
      expect(body.id).toBe(applicationForOfferAId)
      expect(body.status).toBe(ApplicationStatus.ACCEPTED)

      if (dbAvailable && prisma) {
        const appInDb = await prisma.application.findUnique({ where: { id: applicationForOfferAId } })
        expect(appInDb?.status).toBe(ApplicationStatus.ACCEPTED)
        expect(appInDb?.decidedAt).not.toBeNull()
      } else {
        expect(appState.app1Status).toBe(ApplicationStatus.ACCEPTED)
        expect(appState.app1DecidedAt).not.toBeNull()
      }
    })

    it('la coordinación conserva el acceso que ya tenía y puede decidir una postulación (200 OK)', async () => {
      // Coordinación decide (rechaza o acepta) otra postulación
      const response = await fetch(`${baseUrl}/applications/${applicationForCoordDecisionId}/decide`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenCoordinator}`,
        },
        body: JSON.stringify({
          status: 'REJECTED',
        }),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { id: number; status: string }
      expect(body.id).toBe(applicationForCoordDecisionId)
      expect(body.status).toBe(ApplicationStatus.REJECTED)

      if (dbAvailable && prisma) {
        const appInDb = await prisma.application.findUnique({ where: { id: applicationForCoordDecisionId } })
        expect(appInDb?.status).toBe(ApplicationStatus.REJECTED)
      } else {
        expect(appState.app2Status).toBe(ApplicationStatus.REJECTED)
      }
    })
  })
})
