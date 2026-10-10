import { ApplicationStatus } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { OfferService } from '../offer/offer.service'
import { PrismaService } from '../prisma/prisma.service'
import { ApplicationService } from './application.service'

describe('E2-01: Spike — sobrecupo con dos aceptaciones concurrentes', () => {
  let prisma: PrismaService
  let offers: OfferService
  let applications: ApplicationService

  let companyId: number
  let offerId: number
  let studentAId: number
  let studentBId: number
  let applicationAId: number
  let applicationBId: number

  beforeAll(async () => {
    prisma = new PrismaService()
    await prisma.onModuleInit()
    offers = new OfferService(prisma)
    applications = new ApplicationService(prisma, offers)

    const timestamp = Date.now()
    const fakeAuthSecret = process.env.TEST_SECRET ?? 'dummy-secret-value'

    const company = await prisma.company.create({
      data: {
        taxId: `E201${timestamp.toString().slice(-6)}`,
        name: 'Empresa Test E2-01',
        sector: 'Software',
        contactEmail: `e201-${timestamp}@empresa.com`,
      },
    })
    companyId = company.id

    // Oferta con un único cupo: es la condición que debe violarse.
    const offer = await prisma.offer.create({
      data: {
        companyId,
        title: 'Oferta con 1 cupo (E2-01)',
        description: 'Oferta creada para el spike de sobrecupo',
        modality: 'PRESENCIAL',
        seats: 1,
        requiredHours: 240,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
      },
    })
    offerId = offer.id

    const studentA = await prisma.user.create({
      data: {
        email: `e201-a-${timestamp}@example.com`,
        password: fakeAuthSecret,
        fullName: 'Estudiante A E2-01',
        role: 'STUDENT',
      },
    })
    const studentB = await prisma.user.create({
      data: {
        email: `e201-b-${timestamp}@example.com`,
        password: fakeAuthSecret,
        fullName: 'Estudiante B E2-01',
        role: 'STUDENT',
      },
    })
    studentAId = studentA.id
    studentBId = studentB.id

    const applicationA = await prisma.application.create({
      data: { offerId, studentId: studentAId, motivation: 'Postulación A E2-01', status: 'SUBMITTED' },
    })
    const applicationB = await prisma.application.create({
      data: { offerId, studentId: studentBId, motivation: 'Postulación B E2-01', status: 'SUBMITTED' },
    })
    applicationAId = applicationA.id
    applicationBId = applicationB.id
  })

  afterAll(async () => {
    await prisma.application.deleteMany({ where: { offerId } })
    await prisma.offer.deleteMany({ where: { id: offerId } })
    await prisma.user.deleteMany({ where: { id: { in: [studentAId, studentBId] } } })
    await prisma.company.deleteMany({ where: { id: companyId } })
    await prisma.$disconnect()
  })

  it('demuestra el sobrecupo: dos aceptaciones concurrentes sobre una oferta con 1 cupo pasan ambas', async () => {
    // Barrera de sincronización: ninguna de las dos llamadas a acceptedCount()
    // devuelve su resultado hasta que AMBAS ya hicieron su lectura real en la
    // base de datos. Así se fuerza, de forma 100% determinista, la ventana
    // TOCTOU entre el check (acceptedCount) y el use (application.update) sin
    // depender de timing real ni de reintentar el test.
    let resolveBarrier: () => void
    const barrier = new Promise<void>((resolve) => {
      resolveBarrier = resolve
    })
    let readsInFlight = 0

    const originalAcceptedCount = offers.acceptedCount.bind(offers)
    vi.spyOn(offers, 'acceptedCount').mockImplementation(async (offerIdArg: number) => {
      const result = await originalAcceptedCount(offerIdArg)
      readsInFlight += 1
      if (readsInFlight === 2) resolveBarrier()
      await barrier
      return result
    })

    const [resultA, resultB] = await Promise.all([
      applications.decide(applicationAId, ApplicationStatus.ACCEPTED),
      applications.decide(applicationBId, ApplicationStatus.ACCEPTED),
    ])

    // Ninguna de las dos lanzó BadRequestException por falta de cupos: el bug
    // es justamente que ambas "pasan" la validación.
    expect(resultA.status).toBe('ACCEPTED')
    expect(resultB.status).toBe('ACCEPTED')

    const acceptedCount = await prisma.application.count({
      where: { offerId, status: 'ACCEPTED' },
    })
    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })

    // La prueba del sobrecupo: hay más aceptados que cupos disponibles.
    expect(offer.seats).toBe(1)
    expect(acceptedCount).toBe(2)
  })
})
