import { Injectable } from '@nestjs/common'
import { HourLogStatus, Prisma, type Prisma as PrismaTypes } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { type Checkpoint, decodeCheckpoint, encodeCheckpoint } from './checkpoint'
import type { SyncOperationInput, SyncOperationResult } from './dto/push.dto'

// `Prisma` (valor) se usa para `Prisma.PrismaClientKnownRequestError`; el tipo del
// cliente de transacción entra como `PrismaTypes` para no chocar con el namespace.

type DbClient = PrismaTypes.TransactionClient | PrismaService

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async pull(userId: number, since: string | undefined, limit: number) {
    const cursor = decodeCheckpoint(since)
    // El cursor avanza por updatedAt.
    const where = cursor ? { updatedAt: { gt: new Date(cursor.updatedAt) } } : {}
    const order = { updatedAt: 'asc' as const }
    const scope = { placement: { OR: [{ studentId: userId }, { tutorId: userId }] } }

    const [placements, hourLogs, documents, evaluations] = await Promise.all([
      this.prisma.placement.findMany({
        where: { ...where, OR: [{ studentId: userId }, { tutorId: userId }] },
        orderBy: order,
        take: limit,
      }),
      this.prisma.hourLog.findMany({ where: { ...where, ...scope }, orderBy: order, take: limit }),
      this.prisma.document.findMany({ where: { ...where, ...scope }, orderBy: order, take: limit }),
      this.prisma.evaluation.findMany({ where: { ...where, ...scope }, orderBy: order, take: limit }),
    ])

    const newest = [...placements, ...hourLogs, ...documents, ...evaluations]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]

    const checkpoint: Checkpoint | null = newest
      ? { updatedAt: new Date(newest.updatedAt).toISOString(), id: newest.id }
      : cursor

    return {
      changes: { placements, hourLogs, documents, evaluations },
      checkpoint: checkpoint ? encodeCheckpoint(checkpoint) : null,
      hasMore: [placements, hourLogs, documents, evaluations].some((rows) => rows.length === limit),
    }
  }

  async push(userId: number, ops: SyncOperationInput[]) {
    const results: SyncOperationResult[] = []
    for (const op of ops) {
      results.push(await this.processOperation(userId, op))
    }
    return { results }
  }

  private async processOperation(userId: number, op: SyncOperationInput): Promise<SyncOperationResult> {
    // 1. Idempotencia: si la operación ya fue procesada previamente, devolver la respuesta guardada
    const existing = await this.prisma.syncOperation.findUnique({
      where: { clientOpId: op.clientOpId },
    })
    if (existing) {
      return existing.response as unknown as SyncOperationResult
    }

    try {
      return await this.executeInTransaction(async (tx) => {
        // Doble verificación dentro de la transacción por si otra request concurrente completó primero
        const concurrentOp = await tx.syncOperation.findUnique({
          where: { clientOpId: op.clientOpId },
        })
        if (concurrentOp) {
          return concurrentOp.response as unknown as SyncOperationResult
        }

        const opResult = await this.applyOperation(userId, op, tx)
        const normalized = JSON.parse(JSON.stringify(opResult)) as SyncOperationResult
        await tx.syncOperation.create({
          data: {
            clientOpId: op.clientOpId,
            userId,
            response: normalized as unknown as object,
          },
        })
        return normalized
      })
    } catch (err) {
      return this.handleCollisionOrError(userId, op, err)
    }
  }

  private async handleCollisionOrError(
    userId: number,
    op: SyncOperationInput,
    err: unknown,
  ): Promise<SyncOperationResult> {
    // En caso de concurrencia: si otra transacción ganó la carrera en sync_operations,
    // la transacción actual revierte cualquier inserción y devolvemos el resultado ganador.
    const winner = await this.prisma.syncOperation.findUnique({
      where: { clientOpId: op.clientOpId },
    })
    if (winner) {
      return winner.response as unknown as SyncOperationResult
    }

    const result: SyncOperationResult = {
      clientOpId: op.clientOpId,
      status: 'rejected',
      server: null,
      reason: err instanceof Error ? err.message : 'no se pudo aplicar la operación',
    }
    try {
      const normalized = JSON.parse(JSON.stringify(result)) as SyncOperationResult
      await this.prisma.syncOperation.create({
        data: { clientOpId: op.clientOpId, userId, response: normalized as unknown as object },
      })
      return normalized
    } catch {
      return result
    }
  }

  private async executeInTransaction<T>(fn: (tx: PrismaTypes.TransactionClient) => Promise<T>): Promise<T> {
    if (typeof this.prisma.$transaction === 'function') {
      return this.prisma.$transaction(fn)
    }
    return fn(this.prisma as unknown as PrismaTypes.TransactionClient)
  }

  private extractHourLogFields(payload: Record<string, unknown>) {
    return {
      date: new Date(String(payload.date)),
      startTime: String(payload.startTime),
      endTime: String(payload.endTime),
      hours: Number(payload.hours),
      activity: String(payload.activity),
    }
  }

  private async applyOperation(
    userId: number,
    op: SyncOperationInput,
    db: DbClient = this.prisma,
  ): Promise<SyncOperationResult> {
    if (op.entity !== 'hourLog') {
      return { clientOpId: op.clientOpId, status: 'rejected', server: null, reason: 'entidad no sincronizable desde el cliente' }
    }

    if (op.op === 'create') {
      const placement = await db.placement.findUnique({ where: { id: Number(op.payload.placementId) } })
      if (!placement || placement.studentId !== userId) {
        return { clientOpId: op.clientOpId, status: 'rejected', server: null, reason: 'el placement no pertenece al usuario' }
      }

      const fields = this.extractHourLogFields(op.payload as Record<string, unknown>)
      const created = await db.hourLog.create({
        data: {
          placementId: Number(op.payload.placementId),
          ...fields,
          status: 'SUBMITTED',
        },
      })
      return { clientOpId: op.clientOpId, status: 'applied', server: created as never, reason: null }
    }

    const existing = await db.hourLog.findUnique({
      where: { id: Number(op.payload.id) },
      include: { placement: true },
    })
    if (!existing || existing.placement.studentId !== userId) {
      return { clientOpId: op.clientOpId, status: 'rejected', server: null, reason: 'el registro no pertenece al usuario' }
    }

    if (op.op === 'update') {
      // E1-04: si el tutor ya resolvió el registro (APPROVED/REJECTED), el servidor
      // es autoridad sobre el estado y rechaza la edición offline del estudiante.
      if (existing.status === HourLogStatus.APPROVED || existing.status === HourLogStatus.REJECTED) {
        return {
          clientOpId: op.clientOpId,
          status: 'rejected',
          server: existing as unknown as Record<string, unknown>,
          reason:
            existing.status === HourLogStatus.APPROVED
              ? 'el tutor ya aprobó este registro de horas; no se puede editar'
              : 'el tutor ya rechazó este registro de horas; no se puede editar',
        }
      }

      // E1-04: ambos lados en DRAFT/SUBMITTED. Gana la edición más reciente.
      // Primero validamos que el payload.traiga un updatedAt parseable: sin esto,
      // un string inválido produce Invalid Date (getTime() === NaN) y la comparación
      // con el servidor devuelve false, dejando pasar la edición por un fallo
      // silencioso. Si no hay updatedAt o no se puede parsear, rechazamos.
      const rawClientUpdatedAt = op.payload.updatedAt
      const clientUpdatedAt =
        typeof rawClientUpdatedAt === 'string' || rawClientUpdatedAt instanceof Date
          ? new Date(String(rawClientUpdatedAt))
          : null
      if (!clientUpdatedAt || Number.isNaN(clientUpdatedAt.getTime())) {
        return {
          clientOpId: op.clientOpId,
          status: 'rejected',
          server: existing as unknown as Record<string, unknown>,
          reason: 'updatedAt inválido en la operación',
        }
      }
      const serverUpdatedAt = new Date(existing.updatedAt)
      if (Number.isNaN(serverUpdatedAt.getTime())) {
        return {
          clientOpId: op.clientOpId,
          status: 'rejected',
          server: existing as unknown as Record<string, unknown>,
          reason: 'updatedAt inválido en el servidor',
        }
      }
      if (clientUpdatedAt.getTime() <= serverUpdatedAt.getTime()) {
        return {
          clientOpId: op.clientOpId,
          status: 'rejected',
          server: existing as unknown as Record<string, unknown>,
          reason: 'existe una versión más reciente en el servidor',
        }
      }

      const fields = this.extractHourLogFields(op.payload as Record<string, unknown>)

      // Guard atómico: el `where` exige que el status siga siendo DRAFT o SUBMITTED.
      // Si entre la lectura de arriba y este update el tutor aprobó/rechazó el
      // registro, Prisma lanza P2025 (registro no encontrado). Lo capturamos y
      // devolvemos el mismo rechazo legible que ya usamos para esa rama.
      try {
        const updated = await db.hourLog.update({
          where: {
            id: Number(op.payload.id),
            status: { in: [HourLogStatus.DRAFT, HourLogStatus.SUBMITTED] },
          },
          data: {
            ...fields,
            version: { increment: 1 },
          },
        })
        return { clientOpId: op.clientOpId, status: 'applied', server: updated as never, reason: null }
      } catch (err) {
        // Capturamos P2025 tanto por `instanceof` como por `code`, porque algunos
        // clientes de Prisma o builds minificados pueden romper el prototipo.
        const isP2025 =
          (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') ||
          (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025')
        if (isP2025) {
          const current = await db.hourLog.findUnique({
            where: { id: Number(op.payload.id) },
          })
          const status = current?.status
          const reason =
            status === HourLogStatus.APPROVED
              ? 'el tutor aprobó este registro de horas mientras se procesaba la edición; no se puede editar'
              : status === HourLogStatus.REJECTED
                ? 'el tutor rechazó este registro de horas mientras se procesaba la edición; no se puede editar'
                : 'el registro cambió de estado durante la edición'
          return {
            clientOpId: op.clientOpId,
            status: 'rejected',
            server: (current ?? existing) as unknown as Record<string, unknown>,
            reason,
          }
        }
        throw err
      }
    }

    const deleted = await db.hourLog.update({
      where: { id: Number(op.payload.id) },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    })
    return { clientOpId: op.clientOpId, status: 'applied', server: deleted as never, reason: null }
  }
}
