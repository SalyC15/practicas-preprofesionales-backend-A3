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

  // E1-04 · Rama 1: el tutor ya resolvió el registro (APPROVED/REJECTED) y el servidor
  // rechaza la edición offline del estudiante, devolviendo el motivo legible.
  it('rejects offline update when the tutor already approved the hour log', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 42,
      placement: { studentId: 5 },
      status: 'APPROVED',
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    })

    const result = await service.push(5, [
      {
        clientOpId: '22222222-2222-4222-8222-222222222222',
        entity: 'hourLog',
        op: 'update',
        baseVersion: 1,
        payload: {
          id: 42,
          placementId: 1,
          date: '2026-04-02',
          startTime: '08:00',
          endTime: '12:00',
          hours: 4,
          activity: 'Soporte editado',
          updatedAt: '2026-04-03T08:00:00.000Z',
        },
      },
    ])

    expect(result.results[0]).toMatchObject({
      status: 'rejected',
      reason: 'el tutor ya aprobó este registro de horas; no se puede editar',
    })
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  it('rejects offline update when the tutor already rejected the hour log', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 43,
      placement: { studentId: 5 },
      status: 'REJECTED',
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    })

    const result = await service.push(5, [
      {
        clientOpId: '33333333-3333-4333-8333-333333333333',
        entity: 'hourLog',
        op: 'update',
        baseVersion: 1,
        payload: {
          id: 43,
          placementId: 1,
          date: '2026-04-02',
          startTime: '08:00',
          endTime: '12:00',
          hours: 4,
          activity: 'Soporte editado',
          updatedAt: '2026-04-03T08:00:00.000Z',
        },
      },
    ])

    expect(result.results[0]).toMatchObject({
      status: 'rejected',
      reason: 'el tutor ya rechazó este registro de horas; no se puede editar',
    })
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  // E1-04 · Rama 2: ambos lados en DRAFT/SUBMITTED gana la edición más reciente.
  it('applies offline update when the client edit is newer than the server copy', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 44,
      placement: { studentId: 5 },
      status: 'SUBMITTED',
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    })
    prisma.hourLog.update.mockResolvedValue({ id: 44, version: 2 })

    const result = await service.push(5, [
      {
        clientOpId: '44444444-4444-4444-8444-444444444444',
        entity: 'hourLog',
        op: 'update',
        baseVersion: 1,
        payload: {
          id: 44,
          placementId: 1,
          date: '2026-04-02',
          startTime: '08:00',
          endTime: '12:00',
          hours: 4,
          activity: 'Soporte actualizado',
          updatedAt: '2026-04-02T11:00:00.000Z',
        },
      },
    ])

    expect(result.results[0]).toMatchObject({ status: 'applied' })
    expect(prisma.hourLog.update).toHaveBeenCalled()
  })

  it('rejects offline update when the server copy is newer than the client edit', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 45,
      placement: { studentId: 5 },
      status: 'DRAFT',
      updatedAt: new Date('2026-04-02T12:00:00.000Z'),
    })

    const result = await service.push(5, [
      {
        clientOpId: '55555555-5555-4555-8555-555555555555',
        entity: 'hourLog',
        op: 'update',
        baseVersion: 1,
        payload: {
          id: 45,
          placementId: 1,
          date: '2026-04-02',
          startTime: '08:00',
          endTime: '12:00',
          hours: 4,
          activity: 'Soporte viejo',
          updatedAt: '2026-04-02T10:00:00.000Z',
        },
      },
    ])

    expect(result.results[0]).toMatchObject({
      status: 'rejected',
      reason: 'existe una versión más reciente en el servidor',
    })
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  // E1-04 · Hardening tras revisión de Copilot: un payload.updatedAt no parseable
  // (NaN) ya no puede saltarse el chequeo de conflicto por fecha inválida.
  it('rejects offline update when payload.updatedAt is not a valid date', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 46,
      placement: { studentId: 5 },
      status: 'SUBMITTED',
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    })

    const result = await service.push(5, [
      {
        clientOpId: '66666666-4666-4666-8666-666666666666',
        entity: 'hourLog',
        op: 'update',
        baseVersion: 1,
        payload: {
          id: 46,
          placementId: 1,
          date: '2026-04-02',
          startTime: '08:00',
          endTime: '12:00',
          hours: 4,
          activity: 'Soporte',
          updatedAt: 'esto-no-es-una-fecha',
        },
      },
    ])

    expect(result.results[0]).toMatchObject({
      status: 'rejected',
      reason: 'updatedAt inválido en la operación',
    })
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  // E1-04 · Hardening tras revisión de Copilot: el guard atómico en el `where`
  // del update debe capturar el caso en que el tutor aprobó el registro entre
  // la lectura inicial y el update.
  it('rejects offline update with an atomic guard when the tutor resolves between read and write', async () => {
    prisma.hourLog.findUnique
      // primera lectura (status + updatedAt del servidor): SUBMITTED, aún editable
      .mockResolvedValueOnce({
        id: 47,
        placement: { studentId: 5 },
        status: 'SUBMITTED',
        updatedAt: new Date('2026-04-02T10:00:00.000Z'),
      })
      // segunda lectura (tras P2025): el tutor ya lo aprobó
      .mockResolvedValueOnce({
        id: 47,
        placement: { studentId: 5 },
        status: 'APPROVED',
        updatedAt: new Date('2026-04-02T10:30:00.000Z'),
      })

    const p2025 = new Error('No record was found') as Error & { code?: string }
    p2025.code = 'P2025'
    prisma.hourLog.update.mockRejectedValueOnce(p2025)

    const result = await service.push(5, [
      {
        clientOpId: '77777777-4777-4777-8777-777777777777',
        entity: 'hourLog',
        op: 'update',
        baseVersion: 1,
        payload: {
          id: 47,
          placementId: 1,
          date: '2026-04-02',
          startTime: '08:00',
          endTime: '12:00',
          hours: 4,
          activity: 'Soporte',
          updatedAt: '2026-04-02T11:00:00.000Z',
        },
      },
    ])

    expect(result.results[0]).toMatchObject({
      status: 'rejected',
      reason: 'el tutor aprobó este registro de horas mientras se procesaba la edición; no se puede editar',
    })
    // el where del update debe exigir que el status siga siendo DRAFT/SUBMITTED
    expect(prisma.hourLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 47,
          status: { in: ['DRAFT', 'SUBMITTED'] },
        }),
      }),
    )
  })

  // E1-05 · Dos HourLog con el mismo updatedAt deben llegar ambos al cliente en
  // una sola descarga. La implementación usa un cursor compuesto (updatedAt, id),
  // por lo que la siguiente página parte desde (t, maxId) en vez de filtrar con
  // `updatedAt > t` (lo que dejaría al de mayor id sin entregar si quedó empatado).
  it('returns both hour logs when two rows share the exact same updatedAt', async () => {
    const sameInstant = new Date('2026-04-01T12:00:00.000Z')
    const cursorInstant = new Date('2026-04-01T11:00:00.000Z')
    prisma.hourLog.findMany.mockResolvedValueOnce([
      { id: 100, updatedAt: sameInstant, placementId: 1 },
      { id: 101, updatedAt: sameInstant, placementId: 1 },
    ])

    // Construimos un checkpoint previo para que el where lleve el OR compuesto.
    const previousCheckpoint = Buffer.from(
      JSON.stringify({ updatedAt: '2026-04-01T11:00:00.000Z', id: 50 }),
      'utf8',
    ).toString('base64')

    const result = await service.pull(5, previousCheckpoint, 200)

    expect(result.changes.hourLogs).toHaveLength(2)
    expect(result.changes.hourLogs.map((h: { id: number }) => h.id).sort()).toEqual([100, 101])
    expect(result.checkpoint).toBeTypeOf('string')

    // El where de Prisma debe ser un OR compuesto que cubre el empate por id.
    // El segundo miembro del OR fija updatedAt al timestamp del cursor (no al
    // de los registros) y exige id > cursor.id, lo que evita saltarse filas que
    // comparten ese mismo updatedAt.
    expect(prisma.hourLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ updatedAt: { gt: expect.any(Date) } }),
            expect.objectContaining({ updatedAt: cursorInstant, id: { gt: 50 } }),
          ]),
        }),
        orderBy: [
          { updatedAt: 'asc' },
          { id: 'asc' },
        ],
      }),
    )
  })

  // E1-05 · Dos descargas consecutivas con el cursor nunca devuelven la misma
  // fila dos veces ni omiten ninguna, aunque haya empates por `updatedAt`.
  it('walks through tied-updatedAt rows across paginated pulls without duplicates or gaps', async () => {
    const t = new Date('2026-04-01T12:00:00.000Z')
    // Página 1: dos filas empatadas en t (ids 50 y 51).
    // Página 2: el siguiente lote en t (ids 52 y 53) y una fila posterior en t+1.
    prisma.hourLog.findMany
      .mockResolvedValueOnce([
        { id: 50, updatedAt: t, placementId: 1 },
        { id: 51, updatedAt: t, placementId: 1 },
      ])
      .mockResolvedValueOnce([
        { id: 52, updatedAt: t, placementId: 1 },
        { id: 53, updatedAt: t, placementId: 1 },
        { id: 60, updatedAt: new Date(t.getTime() + 1000), placementId: 1 },
      ])

    const page1 = await service.pull(5, undefined, 2)
    const page2 = await service.pull(5, page1.checkpoint ?? undefined, 2)

    const idsPage1 = page1.changes.hourLogs.map((h: { id: number }) => h.id).sort()
    const idsPage2 = page2.changes.hourLogs.map((h: { id: number }) => h.id).sort()

    expect(idsPage1).toEqual([50, 51])
    expect(idsPage2).toEqual([52, 53, 60])

    // Sin solapamiento: la unión de ambas páginas cubre todas las filas y ninguna
    // se repite.
    const allIds = [...idsPage1, ...idsPage2]
    expect(new Set(allIds).size).toBe(allIds.length)

    // La segunda página debe haber partido de un cursor compuesto > (t, 51).
    expect(prisma.hourLog.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ updatedAt: expect.anything() }),
            { updatedAt: t, id: { gt: 51 } },
          ]),
        }),
      }),
    )
  })

  // E1-05 · El cursor es opaco para el cliente: el frontend recibe una cadena
  // base64 y no tiene por qué inspeccionarla. Este test confirma que el
  // checkpoint es un string no vacío y que se reenvía tal cual en el `since`
  // de la siguiente petición.
  it('returns the checkpoint as an opaque base64 string', async () => {
    prisma.hourLog.findMany.mockResolvedValueOnce([
      { id: 200, updatedAt: new Date('2026-04-01T12:00:00.000Z'), placementId: 1 },
    ])

    const result = await service.pull(5, undefined, 200)

    expect(typeof result.checkpoint).toBe('string')
    expect(result.checkpoint).not.toBeNull()
    // no es JSON literal: es base64 que, decodificado, contiene JSON.
    expect(result.checkpoint).not.toMatch(/^\{/)
    // al menos un caracter "no alfanumérico" propio de base64 (=, /, +)
    expect(result.checkpoint).toMatch(/[+/=]/)

    // Si decodificamos, sí aparecen las claves internas — pero el cliente no debe
    // depender de eso.
    const decoded = JSON.parse(Buffer.from(result.checkpoint as string, 'base64').toString('utf8'))
    expect(decoded).toMatchObject({ id: 200 })
    expect(typeof decoded.updatedAt).toBe('string')
  })

  // E1-05 · Cuando hay más filas que el límite, la paginación las entrega todas
  // sin duplicar ni omitir, usando `hasMore` para señalar al cliente que siga
  // pidiendo.
  it('paginates through all rows when there are more than the limit', async () => {
    const t = new Date('2026-04-01T12:00:00.000Z')
    const pages = [
      [{ id: 1, updatedAt: t, placementId: 1 }],
      [{ id: 2, updatedAt: t, placementId: 1 }],
      [{ id: 3, updatedAt: t, placementId: 1 }],
      [{ id: 4, updatedAt: new Date(t.getTime() + 1000), placementId: 1 }],
    ]
    let call = 0
    // mockImplementation a prueba de `Once` colgados de tests anteriores: por
    // seguridad devolvemos `[]` cuando se agotan las páginas programadas.
    prisma.hourLog.findMany.mockImplementation(async () => pages[call++] ?? [])

    const collected: number[] = []
    let cursor: string | undefined = undefined
    for (let i = 0; i < 10; i++) {
      const page = await service.pull(5, cursor, 1)
      const ids = page.changes.hourLogs.map((h: { id: number }) => h.id)
      collected.push(...ids)
      if (!page.hasMore) break
      cursor = page.checkpoint ?? undefined
    }

    expect(collected).toEqual([1, 2, 3, 4])
    expect(new Set(collected).size).toBe(collected.length)
  })
})
