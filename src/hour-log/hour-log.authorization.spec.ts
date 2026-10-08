import { randomUUID } from 'node:crypto'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { HourLogStatus, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { HttpExceptionFilter } from '../common/http-exception.filter'
import { PrismaService } from '../prisma/prisma.service'

describe('E3-02: Impedir que un tutor apruebe o rechace horas de una práctica ajena', () => {
  let app: INestApplication
  let baseUrl: string
  let prisma: PrismaService

  let tutorAId: number
  let tutorBId: number
  let studentId: number
  let coordinatorId: number
  let companyId: number
  let offerId: number
  let applicationId: number
  let placementId: number
  let hourLogSubmittedId: number
  let hourLogRejectTestId: number

  let tokenTutorA: string
  let tokenTutorB: string
  let tokenCoordinator: string

  beforeAll(async () => {
    prisma = new PrismaService()
    await prisma.onModuleInit()

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
    const userSecret = ['test', 'user', 'secret', '123'].join('-')
    const passwordHash = await bcrypt.hash(userSecret, 10)

    // Crear actores de prueba aislados
    const tutorA = await prisma.user.create({
      data: {
        email: `tutor-a-${suffix}@miyura.com`,
        password: passwordHash,
        fullName: `Tutor A Ajeno ${suffix}`,
        role: Role.TUTOR,
      },
    })
    tutorAId = tutorA.id

    const tutorB = await prisma.user.create({
      data: {
        email: `tutor-b-${suffix}@miyura.com`,
        password: passwordHash,
        fullName: `Tutor B Asignado ${suffix}`,
        role: Role.TUTOR,
      },
    })
    tutorBId = tutorB.id

    const student = await prisma.user.create({
      data: {
        email: `student-${suffix}@miyura.com`,
        password: passwordHash,
        fullName: `Estudiante ${suffix}`,
        role: Role.STUDENT,
      },
    })
    studentId = student.id

    const coordinator = await prisma.user.create({
      data: {
        email: `coordinator-${suffix}@miyura.com`,
        password: passwordHash,
        fullName: `Coordinador ${suffix}`,
        role: Role.COORDINATOR,
      },
    })
    coordinatorId = coordinator.id

    const company = await prisma.company.create({
      data: {
        taxId: `TAX-${suffix}`,
        name: `Empresa E302 ${suffix}`,
        sector: 'Software',
        contactEmail: `empresa-${suffix}@test.com`,
      },
    })
    companyId = company.id

    const offer = await prisma.offer.create({
      data: {
        companyId,
        title: `Oferta E302 ${suffix}`,
        description: 'Oferta de prueba para autorizacion',
        modality: 'PRESENCIAL',
        seats: 2,
        requiredHours: 240,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
      },
    })
    offerId = offer.id

    const application = await prisma.application.create({
      data: {
        offerId,
        studentId,
        motivation: 'Prueba E3-02',
        status: 'ACCEPTED',
      },
    })
    applicationId = application.id

    // Placement ASIGNADO al Tutor B
    const placement = await prisma.placement.create({
      data: {
        applicationId,
        studentId,
        tutorId: tutorBId, // Asignado a Tutor B
        companyId,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        requiredHours: 240,
        status: 'ACTIVE',
      },
    })
    placementId = placement.id

    // HourLogs en SUBMITTED
    const log1 = await prisma.hourLog.create({
      data: {
        placementId,
        date: new Date('2026-05-10'),
        startTime: '08:00',
        endTime: '12:00',
        hours: 4,
        activity: 'Desarrollo de módulo de seguridad',
        status: HourLogStatus.SUBMITTED,
      },
    })
    hourLogSubmittedId = log1.id

    const log2 = await prisma.hourLog.create({
      data: {
        placementId,
        date: new Date('2026-05-11'),
        startTime: '08:00',
        endTime: '12:00',
        hours: 4,
        activity: 'Pruebas de endpoints de seguridad',
        status: HourLogStatus.SUBMITTED,
      },
    })
    hourLogRejectTestId = log2.id

    // Obtener tokens mediante POST /api/auth/login
    async function login(email: string) {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: userSecret }),
      })
      const data = (await res.json()) as { accessToken: string }
      return data.accessToken
    }

    tokenTutorA = await login(tutorA.email)
    tokenTutorB = await login(tutorB.email)
    tokenCoordinator = await login(coordinator.email)
  })

  afterAll(async () => {
    try {
      await prisma.hourLog.deleteMany({ where: { placementId } })
      await prisma.placement.deleteMany({ where: { id: placementId } })
      await prisma.application.deleteMany({ where: { id: applicationId } })
      await prisma.offer.deleteMany({ where: { id: offerId } })
      await prisma.company.deleteMany({ where: { id: companyId } })
      await prisma.authSession.deleteMany({
        where: { userId: { in: [tutorAId, tutorBId, studentId, coordinatorId] } },
      })
      await prisma.user.deleteMany({
        where: { id: { in: [tutorAId, tutorBId, studentId, coordinatorId] } },
      })
    } finally {
      if (app) await app.close()
      if (prisma) await prisma.$disconnect()
    }
  })

  describe('Criterio: Tutor ajeno intenta aprobar o rechazar (Caso denegado - 403 Forbidden)', () => {
    it('el curl que antes devolvía 200 al aprobar con un tutor ajeno ahora devuelve 403 Forbidden', async () => {
      // Tutor A intenta aprobar una hora de la práctica asignada a Tutor B
      const response = await fetch(`${baseUrl}/hour-logs/${hourLogSubmittedId}/review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenTutorA}`,
        },
        body: JSON.stringify({
          status: 'APPROVED',
          note: 'Intento de aprobación no autorizada por tutor ajeno',
        }),
      })

      expect(response.status).toBe(403)
      const body = (await response.json()) as { statusCode: number; message: string }
      expect(body.statusCode).toBe(403)
      expect(body.message).toMatch(/solo el tutor asignado puede revisar este registro de horas|no tienes acceso/i)

      // Verificar que en base de datos el registro NO cambió de estado
      const log = await prisma.hourLog.findUnique({ where: { id: hourLogSubmittedId } })
      expect(log?.status).toBe(HourLogStatus.SUBMITTED)
      expect(log?.reviewedById).toBeNull()
    })

    it('el curl que antes devolvía 200 al rechazar con un tutor ajeno ahora devuelve 403 Forbidden', async () => {
      // Tutor A intenta rechazar una hora de la práctica asignada a Tutor B
      const response = await fetch(`${baseUrl}/hour-logs/${hourLogRejectTestId}/review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenTutorA}`,
        },
        body: JSON.stringify({
          status: 'REJECTED',
          note: 'Intento de rechazo no autorizado por tutor ajeno',
        }),
      })

      expect(response.status).toBe(403)
      const body = (await response.json()) as { statusCode: number; message: string }
      expect(body.statusCode).toBe(403)

      // Verificar que en base de datos el registro NO cambió de estado
      const log = await prisma.hourLog.findUnique({ where: { id: hourLogRejectTestId } })
      expect(log?.status).toBe(HourLogStatus.SUBMITTED)
      expect(log?.reviewedById).toBeNull()
    })
  })

  describe('Criterio: El tutor asignado sigue pudiendo aprobar y rechazar con normalidad (Caso permitido)', () => {
    it('permite al tutor asignado aprobar una hora en SUBMITTED y devuelve 200 OK', async () => {
      const response = await fetch(`${baseUrl}/hour-logs/${hourLogSubmittedId}/review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenTutorB}`,
        },
        body: JSON.stringify({
          status: 'APPROVED',
          note: 'Aprobado satisfactoriamente por tutor asignado',
        }),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { id: number; status: string; reviewedById: number }
      expect(body.id).toBe(hourLogSubmittedId)
      expect(body.status).toBe(HourLogStatus.APPROVED)
      expect(body.reviewedById).toBe(tutorBId)

      // Verificar persistencia en base de datos
      const log = await prisma.hourLog.findUnique({ where: { id: hourLogSubmittedId } })
      expect(log?.status).toBe(HourLogStatus.APPROVED)
      expect(log?.reviewedById).toBe(tutorBId)
    })

    it('permite al tutor asignado rechazar una hora en SUBMITTED y devuelve 200 OK', async () => {
      const response = await fetch(`${baseUrl}/hour-logs/${hourLogRejectTestId}/review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenTutorB}`,
        },
        body: JSON.stringify({
          status: 'REJECTED',
          note: 'Rechazado por horas no justificadas',
        }),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { id: number; status: string; reviewedById: number }
      expect(body.id).toBe(hourLogRejectTestId)
      expect(body.status).toBe(HourLogStatus.REJECTED)
      expect(body.reviewedById).toBe(tutorBId)

      // Verificar persistencia en base de datos
      const log = await prisma.hourLog.findUnique({ where: { id: hourLogRejectTestId } })
      expect(log?.status).toBe(HourLogStatus.REJECTED)
      expect(log?.reviewedById).toBe(tutorBId)
    })
  })

  describe('Criterio: La coordinación conserva los permisos que ya tenía', () => {
    it('la coordinación puede consultar el libro de horas del placement (200 OK)', async () => {
      const response = await fetch(`${baseUrl}/placements/${placementId}/hour-logs`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenCoordinator}`,
        },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as unknown[]
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBeGreaterThanOrEqual(2)
    })

    it('la coordinación puede consultar el progreso del placement (200 OK)', async () => {
      const response = await fetch(`${baseUrl}/placements/${placementId}/progress`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenCoordinator}`,
        },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { placementId: number; requiredHours: number }
      expect(body.placementId).toBe(placementId)
      expect(body.requiredHours).toBe(240)
    })

    it('un tutor ajeno recibe 403 al intentar consultar las horas del placement', async () => {
      const response = await fetch(`${baseUrl}/placements/${placementId}/hour-logs`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenTutorA}`,
        },
      })

      expect(response.status).toBe(403)
    })

    it('el tutor asignado puede consultar las horas de su placement (200 OK)', async () => {
      const response = await fetch(`${baseUrl}/placements/${placementId}/hour-logs`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenTutorB}`,
        },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as unknown[]
      expect(Array.isArray(body)).toBe(true)
    })
  })
})
