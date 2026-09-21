import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaService } from '../prisma/prisma.service'
import type { SyncOperationInput } from './dto/push.dto'
import { SyncService } from './sync.service'

describe('E1-03: Integración de idempotencia y prevención de duplicados', () => {
  let prisma: PrismaService
  let service: SyncService
  let studentId: number
  let placementId: number
  const createdClientOpIds: string[] = []

  beforeAll(async () => {
    prisma = new PrismaService()
    await prisma.onModuleInit()
    service = new SyncService(prisma)

    // Buscar una asignación existente activa para la prueba
    const placement = await prisma.placement.findFirst({
      where: { status: 'ACTIVE' },
    })

    if (placement) {
      studentId = placement.studentId
      placementId = placement.id
    } else {
      // Si no existe, crear usuario y placement para asegurar entorno autónomo
      const fakeAuthSecret = process.env.TEST_SECRET ?? 'dummy-secret-value'
      const user = await prisma.user.create({
        data: {
          email: `test-e103-${Date.now()}@example.com`,
          password: fakeAuthSecret,
          fullName: 'Estudiante Test E1-03',
          role: 'STUDENT',
        },
      })
      const company = await prisma.company.findFirst()
      const tutor = await prisma.user.findFirst({ where: { role: 'TUTOR' } })
      const offer = await prisma.offer.findFirst()
      const app = await prisma.application.create({
        data: {
          offerId: offer?.id ?? 1,
          studentId: user.id,
          motivation: 'Test',
          status: 'ACCEPTED',
        },
      })
      const newPlacement = await prisma.placement.create({
        data: {
          applicationId: app.id,
          studentId: user.id,
          tutorId: tutor?.id ?? 1,
          companyId: company?.id ?? 1,
          startDate: new Date('2026-03-01'),
          endDate: new Date('2026-07-31'),
          requiredHours: 240,
          status: 'ACTIVE',
        },
      })
      studentId = user.id
      placementId = newPlacement.id
    }
  })

  afterAll(async () => {
    if (createdClientOpIds.length > 0) {
      await prisma.syncOperation.deleteMany({
        where: { clientOpId: { in: createdClientOpIds } },
      })
      await prisma.hourLog.deleteMany({
        where: { activity: { contains: 'E1-03' } },
      })
    }
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
