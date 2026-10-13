import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaService } from '../prisma/prisma.service'
import type { SyncOperationInput } from './dto/push.dto'
import { SyncService } from './sync.service'

describe('E1-03: Integración de idempotencia y prevención de duplicados', () => {
  let prisma: PrismaService
  let service: SyncService
  let studentId: number
  let placementId: number
  let companyId: number
  let tutorId: number
  let offerId: number
  let applicationId: number
  const createdClientOpIds: string[] = []

  beforeAll(async () => {
    prisma = new PrismaService()
    await prisma.onModuleInit()
    service = new SyncService(prisma)

    // Fixtures propios: reutilizar el primer placement/oferta hace que esta prueba
    // pueda enlazar datos creados por otra suite, ya que Vitest ejecuta archivos en paralelo.
    const suffix = randomUUID()
    const fakeAuthSecret = process.env.TEST_SECRET ?? 'dummy-secret-value'

    const company = await prisma.company.create({
      data: {
        taxId: `E103-${suffix}`,
        name: 'Empresa Test E1-03',
        sector: 'Software',
        contactEmail: `e103-${suffix}@empresa.test`,
      },
    })
    companyId = company.id

    const tutor = await prisma.user.create({
      data: {
        email: `tutor-e103-${suffix}@example.test`,
        password: fakeAuthSecret,
        fullName: 'Tutor Test E1-03',
        role: 'TUTOR',
      },
    })
    tutorId = tutor.id

    const offer = await prisma.offer.create({
      data: {
        companyId,
        title: 'Oferta Test E1-03',
        description: 'Oferta aislada para la prueba de sincronización',
        modality: 'PRESENCIAL',
        seats: 5,
        requiredHours: 240,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
      },
    })
    offerId = offer.id

    const student = await prisma.user.create({
      data: {
        email: `student-e103-${suffix}@example.test`,
        password: fakeAuthSecret,
        fullName: 'Estudiante Test E1-03',
        role: 'STUDENT',
      },
    })
    studentId = student.id

    const app = await prisma.application.create({
      data: {
        offerId,
        studentId,
        motivation: 'Test motivación CI',
        status: 'ACCEPTED',
      },
    })
    applicationId = app.id

    const newPlacement = await prisma.placement.create({
      data: {
        applicationId,
        studentId,
        tutorId,
        companyId,
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-07-31'),
        requiredHours: 240,
        status: 'ACTIVE',
      },
    })

    studentId = student.id
    placementId = newPlacement.id
  })

  afterAll(async () => {
    if (!prisma) return

    if (createdClientOpIds.length > 0) {
      await prisma.syncOperation.deleteMany({
        where: { clientOpId: { in: createdClientOpIds } },
      })
    }

    if (placementId !== undefined) {
      await prisma.hourLog.deleteMany({
        where: { placementId },
      })
      await prisma.document.deleteMany({ where: { placementId } })
      await prisma.evaluation.deleteMany({ where: { placementId } })
      await prisma.placement.deleteMany({ where: { id: placementId } })
    }

    if (applicationId !== undefined) await prisma.application.deleteMany({ where: { id: applicationId } })
    if (offerId !== undefined) await prisma.offer.deleteMany({ where: { id: offerId } })
    if (studentId !== undefined) await prisma.user.deleteMany({ where: { id: studentId } })
    if (tutorId !== undefined) await prisma.user.deleteMany({ where: { id: tutorId } })
    if (companyId !== undefined) await prisma.company.deleteMany({ where: { id: companyId } })

    await prisma.$disconnect()
  })

  it('no crea una hora dos veces en reintentos secuenciales con el mismo clientOpId', async () => {
    const clientOpId = crypto.randomUUID()
    createdClientOpIds.push(clientOpId)

    const op: SyncOperationInput = {
      clientOpId,
      entity: 'hourLog',
      op: 'create',
      baseVersion: null,
      payload: {
        placementId,
        date: '2026-04-15',
        startTime: '08:00',
        endTime: '12:00',
        hours: 4,
        activity: 'Práctica E1-03 secuencial',
      },
    }

    // Primer intento
    const firstResult = await service.push(studentId, [op])
    expect(firstResult.results[0].status).toBe('applied')
    const firstCreatedId = (firstResult.results[0].server as { id: number }).id

    // Segundo intento (reintento del cliente con el mismo clientOpId)
    const retryResult = await service.push(studentId, [op])

    // 1. La respuesta del reintento es indistinguible de la primera
    expect(retryResult).toEqual(firstResult)
    expect((retryResult.results[0].server as { id: number }).id).toBe(firstCreatedId)

    // 2. Solo hay una fila en base de datos
    const dbCount = await prisma.hourLog.count({
      where: {
        placementId,
        activity: 'Práctica E1-03 secuencial',
      },
    })
    expect(dbCount).toBe(1)
  })

  it('soporta envíos concurrentes de la misma operación y deja una sola fila', async () => {
    const clientOpId = crypto.randomUUID()
    createdClientOpIds.push(clientOpId)

    const op: SyncOperationInput = {
      clientOpId,
      entity: 'hourLog',
      op: 'create',
      baseVersion: null,
      payload: {
        placementId,
        date: '2026-04-16',
        startTime: '14:00',
        endTime: '18:00',
        hours: 4,
        activity: 'Práctica E1-03 concurrente',
      },
    }

    // Disparar dos peticiones push en paralelo al mismo instante
    const [resA, resB] = await Promise.all([
      service.push(studentId, [op]),
      service.push(studentId, [op]),
    ])

    expect(resA.results[0].status).toBe('applied')
    expect(resB.results[0].status).toBe('applied')

    // Ambos clientes obtienen el mismo ID de registro en el servidor
    const idA = (resA.results[0].server as { id: number }).id
    const idB = (resB.results[0].server as { id: number }).id
    expect(idA).toBe(idB)

    // En la base de datos solo se creó 1 fila a pesar de la concurrencia
    const count = await prisma.hourLog.count({
      where: {
        placementId,
        activity: 'Práctica E1-03 concurrente',
      },
    })
    expect(count).toBe(1)
  })
})
