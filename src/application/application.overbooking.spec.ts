import { BadRequestException } from '@nestjs/common'
import { ApplicationStatus } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OfferService } from '../offer/offer.service'
import { PrismaService } from '../prisma/prisma.service'
import { ApplicationService } from './application.service'

describe('E2-02: Garantizar que nunca se acepten más postulaciones que cupos', () => {
  let prisma: PrismaService
  let offers: OfferService
  let applications: ApplicationService

  const createdCompanyIds: number[] = []
  const createdOfferIds: number[] = []
  const createdUserIds: number[] = []

  let offer1SeatId: number
  let app1SeatAId: number
  let app1SeatBId: number
  let app1SeatExtraId: number

  let offer2SeatsId: number
  let app2SeatsAId: number
  let app2SeatsBId: number

  beforeAll(async () => {
    prisma = new PrismaService()
    await prisma.onModuleInit()
    offers = new OfferService(prisma)
    applications = new ApplicationService(prisma, offers)

    const suffix = randomUUID().slice(0, 8)
    const fakeAuthSecret = process.env.TEST_SECRET ?? 'dummy-secret-value'

    const company = await prisma.company.create({
      data: {
        taxId: `E202-${suffix}`,
        name: `Empresa Test E2-02 ${suffix}`,
        sector: 'Software',
        contactEmail: `e202-${suffix}@empresa.com`,
      },
    })
    createdCompanyIds.push(company.id)

    // Oferta 1: 1 cupo para probar concurrencia sobre la última plaza
    const offer1 = await prisma.offer.create({
      data: {
        companyId: company.id,
        title: 'Oferta 1 cupo (E2-02)',
        description: 'Prueba de concurrencia y sobrecupo',
        modality: 'PRESENCIAL',
        seats: 1,
        requiredHours: 240,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
      },
    })
    offer1SeatId = offer1.id
    createdOfferIds.push(offer1.id)

    // Oferta 2: 2 cupos para probar que ambas aceptaciones pasan cuando hay cupos
    const offer2 = await prisma.offer.create({
      data: {
        companyId: company.id,
        title: 'Oferta 2 cupos (E2-02)',
        description: 'Prueba de cupos suficientes',
        modality: 'PRESENCIAL',
        seats: 2,
        requiredHours: 240,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
      },
    })
    offer2SeatsId = offer2.id
    createdOfferIds.push(offer2.id)

    // Usuarios y postulaciones para Oferta 1
    const student1A = await prisma.user.create({
      data: {
        email: `student-1a-${suffix}@example.com`,
        password: fakeAuthSecret,
        fullName: 'Estudiante 1A E2-02',
        role: 'STUDENT',
      },
    })
    const student1B = await prisma.user.create({
      data: {
        email: `student-1b-${suffix}@example.com`,
        password: fakeAuthSecret,
        fullName: 'Estudiante 1B E2-02',
        role: 'STUDENT',
      },
    })
    const student1Extra = await prisma.user.create({
      data: {
        email: `student-1extra-${suffix}@example.com`,
        password: fakeAuthSecret,
        fullName: 'Estudiante 1Extra E2-02',
        role: 'STUDENT',
      },
    })
    createdUserIds.push(student1A.id, student1B.id, student1Extra.id)

    const app1A = await prisma.application.create({
      data: { offerId: offer1SeatId, studentId: student1A.id, motivation: 'Postulación 1A', status: 'SUBMITTED' },
    })
    const app1B = await prisma.application.create({
      data: { offerId: offer1SeatId, studentId: student1B.id, motivation: 'Postulación 1B', status: 'SUBMITTED' },
    })
    const app1Extra = await prisma.application.create({
      data: { offerId: offer1SeatId, studentId: student1Extra.id, motivation: 'Postulación 1Extra', status: 'SUBMITTED' },
    })
    app1SeatAId = app1A.id
    app1SeatBId = app1B.id
    app1SeatExtraId = app1Extra.id

    // Usuarios y postulaciones para Oferta 2
    const student2A = await prisma.user.create({
      data: {
        email: `student-2a-${suffix}@example.com`,
        password: fakeAuthSecret,
        fullName: 'Estudiante 2A E2-02',
        role: 'STUDENT',
      },
    })
    const student2B = await prisma.user.create({
      data: {
        email: `student-2b-${suffix}@example.com`,
        password: fakeAuthSecret,
        fullName: 'Estudiante 2B E2-02',
        role: 'STUDENT',
      },
    })
    createdUserIds.push(student2A.id, student2B.id)

    const app2A = await prisma.application.create({
      data: { offerId: offer2SeatsId, studentId: student2A.id, motivation: 'Postulación 2A', status: 'SUBMITTED' },
    })
    const app2B = await prisma.application.create({
      data: { offerId: offer2SeatsId, studentId: student2B.id, motivation: 'Postulación 2B', status: 'SUBMITTED' },
    })
    app2SeatsAId = app2A.id
    app2SeatsBId = app2B.id
  })

  afterAll(async () => {
    if (!prisma) return

    if (createdOfferIds.length > 0) {
      await prisma.application.deleteMany({ where: { offerId: { in: createdOfferIds } } })
      await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } })
    }

    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
    }

    if (createdCompanyIds.length > 0) {
      await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } })
    }

    await prisma.$disconnect()
  })

  it('con la última plaza libre y dos aceptaciones simultáneas, exactamente una tiene éxito y la otra recibe BadRequestException', async () => {
    const results = await Promise.allSettled([
      applications.decide(app1SeatAId, ApplicationStatus.ACCEPTED),
      applications.decide(app1SeatBId, ApplicationStatus.ACCEPTED),
    ])

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof applications.decide>>> => r.status === 'fulfilled')
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    expect(fulfilled[0].value.status).toBe(ApplicationStatus.ACCEPTED)
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException)
    expect(rejected[0].reason.message).toBe('la oferta ya no tiene cupos')

    const acceptedCount = await prisma.application.count({
      where: { offerId: offer1SeatId, status: ApplicationStatus.ACCEPTED },
    })
    expect(acceptedCount).toBe(1)
  })

  it('permite que dos aceptaciones simultáneas pasen cuando la oferta tiene 2 cupos disponibles', async () => {
    const results = await Promise.allSettled([
      applications.decide(app2SeatsAId, ApplicationStatus.ACCEPTED),
      applications.decide(app2SeatsBId, ApplicationStatus.ACCEPTED),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(2)
    expect(rejected).toHaveLength(0)

    const acceptedCount = await prisma.application.count({
      where: { offerId: offer2SeatsId, status: ApplicationStatus.ACCEPTED },
    })
    expect(acceptedCount).toBe(2)
  })

  it('rechaza mediante el trigger en base de datos un update directo a ACCEPTED sobre una oferta llena', async () => {
    // La oferta 1 ya tiene su único cupo ocupado tras el test anterior.
    // Un intento directo de saltarse el servicio debe ser rechazado por el trigger de Postgres.
    await expect(
      prisma.application.update({
        where: { id: app1SeatExtraId },
        data: { status: ApplicationStatus.ACCEPTED },
      }),
    ).rejects.toThrow()

    const dbApp = await prisma.application.findUniqueOrThrow({ where: { id: app1SeatExtraId } })
    expect(dbApp.status).toBe(ApplicationStatus.SUBMITTED)
  })
})
