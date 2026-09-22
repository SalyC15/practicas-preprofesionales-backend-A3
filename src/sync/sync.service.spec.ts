import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncService } from './sync.service'

const prisma = {
  placement: { findMany: vi.fn(), findUnique: vi.fn() },
  hourLog: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  document: { findMany: vi.fn() },
  evaluation: { findMany: vi.fn() },
  syncOperation: { create: vi.fn(), findUnique: vi.fn() },
  $transaction: vi.fn((cb) => (typeof cb === 'function' ? cb(prisma) : Promise.all(cb))),
}

describe('SyncService', () => {
  let service: SyncService

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.placement.findMany.mockResolvedValue([])
    prisma.document.findMany.mockResolvedValue([])
    prisma.evaluation.findMany.mockResolvedValue([])
    prisma.syncOperation.findUnique.mockResolvedValue(null)
    service = new SyncService(prisma as never)
  })

  it('returns changes and a checkpoint from the newest row', async () => {
    prisma.hourLog.findMany.mockResolvedValue([
      { id: 9, updatedAt: new Date('2026-04-01T12:00:00.000Z'), placementId: 1 },
    ])

    const result = await service.pull(5, undefined, 200)

    expect(result.changes.hourLogs).toHaveLength(1)
    expect(result.checkpoint).toBeTypeOf('string')
    expect(result.hasMore).toBe(false)
  })

  it('applies a create operation and returns applied', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5 })
    prisma.hourLog.create.mockResolvedValue({ id: 77, version: 1 })

    const result = await service.push(5, [
      {
        clientOpId: '11111111-1111-4111-8111-111111111111',
        entity: 'hourLog',
        op: 'create',
        baseVersion: null,
        payload: { placementId: 1, date: '2026-04-02', startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Soporte' },
      },
    ])

    expect(result.results[0]).toMatchObject({ status: 'applied' })
    expect(prisma.syncOperation.create).toHaveBeenCalled()
  })

  it('returns existing result without creating a duplicate when clientOpId was already processed', async () => {
    const existingResponse = {
      clientOpId: '11111111-1111-4111-8111-111111111111',
      status: 'applied',
      server: { id: 77, version: 1 },
      reason: null,
    }
    prisma.syncOperation.findUnique.mockResolvedValue({
      clientOpId: '11111111-1111-4111-8111-111111111111',
      userId: 5,
      response: existingResponse,
    })

    const result = await service.push(5, [
      {
        clientOpId: '11111111-1111-4111-8111-111111111111',
        entity: 'hourLog',
        op: 'create',
        baseVersion: null,
        payload: { placementId: 1, date: '2026-04-02', startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Soporte' },
      },
    ])

    expect(result.results[0]).toEqual(existingResponse)
    expect(prisma.hourLog.create).not.toHaveBeenCalled()
    expect(prisma.syncOperation.create).not.toHaveBeenCalled()
  })

  it('recovers winning response when concurrent execution hits a unique constraint', async () => {
    const winningResponse = {
      clientOpId: '11111111-1111-4111-8111-111111111111',
      status: 'applied',
      server: { id: 88, version: 1 },
      reason: null,
    }
    // Primer findUnique (fuera de tx) no encuentra nada
    prisma.syncOperation.findUnique
      .mockResolvedValueOnce(null)
      // findUnique dentro de tx tampoco encuentra nada
      .mockResolvedValueOnce(null)
      // findUnique tras el fallo por concurrencia encuentra el ganador
      .mockResolvedValueOnce({
        clientOpId: '11111111-1111-4111-8111-111111111111',
        userId: 5,
        response: winningResponse,
      })

    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5 })
    prisma.hourLog.create.mockResolvedValue({ id: 89, version: 1 })
    prisma.syncOperation.create.mockRejectedValueOnce(new Error('Unique constraint failed on the fields: (`clientOpId`)'))

    const result = await service.push(5, [
      {
        clientOpId: '11111111-1111-4111-8111-111111111111',
        entity: 'hourLog',
        op: 'create',
        baseVersion: null,
        payload: { placementId: 1, date: '2026-04-02', startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Soporte' },
      },
    ])

    expect(result.results[0]).toEqual(winningResponse)
  })
})
