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

    // Si ya existe un placement activo (entorno local con seed), lo usamos
    const existingPlacement = await prisma.placement.findFirst({
      where: { status: 'ACTIVE' },
    })

    if (existingPlacement) {
      studentId = existingPlacement.studentId
      placementId = existingPlacement.id
      return
    }

    // En CI (donde la base de datos corre limpia sin seed), creamos los registros necesarios
    const timestamp = Date.now()
    const fakeAuthSecret = process.env.TEST_SECRET ?? 'dummy-secret-value'

    let company = await prisma.company.findFirst()
    if (!company) {
      company = await prisma.company.create({
        data: {
          taxId: `179${timestamp.toString().slice(-7)}001`,
          name: 'Empresa Test CI',
          sector: 'Software',
          contactEmail: `ci-${timestamp}@empresa.com`,
        },
      })
    }

    let tutor = await prisma.user.findFirst({ where: { role: 'TUTOR' } })
    if (!tutor) {
      tutor = await prisma.user.create({
        data: {
          email: `tutor-ci-${timestamp}@example.com`,
          password: fakeAuthSecret,
          fullName: 'Tutor CI',
          role: 'TUTOR',
        },
      })
    }

    let offer = await prisma.offer.findFirst()
    if (!offer) {
      offer = await prisma.offer.create({
        data: {
          companyId: company.id,
          title: 'Oferta Test CI',
          description: 'Descripción test',
          modality: 'PRESENCIAL',
          seats: 5,
          requiredHours: 240,
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-12-31'),
        },
      })
    }

    const student = await prisma.user.create({
      data: {
        email: `student-ci-${timestamp}@example.com`,
        password: fakeAuthSecret,
        fullName: 'Estudiante Test CI',
        role: 'STUDENT',
      },
    })

    const app = await prisma.application.create({
      data: {
        offerId: offer.id,
        studentId: student.id,
        motivation: 'Test motivación CI',
        status: 'ACCEPTED',
      },
    })

    const newPlacement = await prisma.placement.create({
      data: {
        applicationId: app.id,
        studentId: student.id,
        tutorId: tutor.id,
        companyId: company.id,
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
