import { Injectable } from '@nestjs/common'
import { HourLogStatus, Prisma, type Prisma as PrismaTypes } from '@prisma/client'
import { validateHourLogCalendarDate } from '../common/calendar-date'
import { InstitutionTimezoneConfig } from '../common/institution-timezone.config'
import { PrismaService } from '../prisma/prisma.service'
import { type Checkpoint, decodeCheckpoint, encodeCheckpoint } from './checkpoint'
import type { SyncOperationInput, SyncOperationResult } from './dto/push.dto'
import { validateHourLogHours, validateHourLogTime, validateHourLogTimes } from '../hour-log/hour-log.validation'

// `Prisma` (valor) se usa para `Prisma.PrismaClientKnownRequestError`; el tipo del
// cliente de transacción entra como `PrismaTypes` para no chocar con el namespace.

type DbClient = PrismaTypes.TransactionClient | PrismaService

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly institutionTimezone: InstitutionTimezoneConfig = new InstitutionTimezoneConfig(),
  ) {}

  async pull(userId: number, since: string | undefined, limit: number) {
    const cursor = decodeCheckpoint(since)
    // E1-05: el cursor es compuesto (updatedAt, id). El filtro debe desempatar por id
    // para no saltarse filas que comparten el mismo `updatedAt` (mismo instante).
    const where = this.buildCursorWhere(cursor)
    const order = [{ updatedAt: 'asc' as const }, { id: 'asc' as const }]
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

    // El checkpoint es la última fila del orden global (updatedAt asc, id asc) entre
    // las cuatro entidades. Eso garantiza que la siguiente página parta exactamente
    // desde donde terminó esta, sin duplicar y sin saltarse filas con el mismo
    // `updatedAt` (que serían indistinguibles solo por timestamp).
    const merged = [...placements, ...hourLogs, ...documents, ...evaluations]
    const lastByOrder = this.pickLastByOrder(merged)
    const checkpoint: Checkpoint | null = lastByOrder
      ? { updatedAt: new Date(lastByOrder.updatedAt).toISOString(), id: lastByOrder.id }
      : cursor

    return {
      changes: { placements, hourLogs, documents, evaluations },
      checkpoint: checkpoint ? encodeCheckpoint(checkpoint) : null,
      hasMore: [placements, hourLogs, documents, evaluations].some((rows) => rows.length === limit),
    }
  }

  // E1-05: el cursor se compone de (updatedAt, id). Devuelve filas que están
  // estrictamente después del cursor en el orden lexicográfico (updatedAt, id).
  private buildCursorWhere(cursor: Checkpoint | null) {
    if (!cursor) return {}
    const t = new Date(cursor.updatedAt)
    return {
      OR: [
        { updatedAt: { gt: t } },
        { updatedAt: t, id: { gt: cursor.id } },
      ],
    }
  }

  // E1-05: dada la concatenación de las 4 entidades devueltas en esta página,
  // devuelve la fila "más alta" en el orden (updatedAt asc, id asc), o null si
  // no hay filas. Es lo que el cliente usará como checkpoint para la siguiente
  // descarga, y es estable porque Prisma ya ordenó cada entidad por las mismas
  // dos claves.
  private pickLastByOrder(
    rows: Array<{ id: number; updatedAt: Date | string }>,
  ): { id: number; updatedAt: Date | string } | null {
    if (rows.length === 0) return null
    let best = rows[0]
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const bestTime = new Date(best.updatedAt).getTime()
      const rowTime = new Date(row.updatedAt).getTime()
      if (rowTime > bestTime || (rowTime === bestTime && row.id > best.id)) {
        best = row
      }
    }
    return best
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

  private normalizeHourLogDate(input: unknown, placement: { startDate: Date; endDate: Date | null }): Date {
    return validateHourLogCalendarDate(
      input as string | Date,
      placement,
      this.institutionTimezone.timeZone,
      this.institutionTimezone.now(),
    ).utcMidnight
  }

  private extractHourLogFields(payload: Record<string, unknown>, placement: { startDate: Date; endDate: Date | null }) {
    const startTime = String(payload.startTime)
    const endTime = String(payload.endTime)
    const hours = Number(payload.hours)
    validateHourLogHours(hours)
    validateHourLogTimes({ startTime, endTime })

    return {
      date: this.normalizeHourLogDate(payload.date, placement),
      startTime,
      endTime,
      hours,
      activity: String(payload.activity),
    }
  }

  private extractHourLogUpdateFields(
    payload: Record<string, unknown>,
    placement: { startDate: Date; endDate: Date | null },
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = {}
    if (Object.prototype.hasOwnProperty.call(payload, 'date')) {
      fields.date = this.normalizeHourLogDate(payload.date, placement)
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'startTime')) {
      const startTime = String(payload.startTime)
      fields.startTime = startTime
      validateHourLogTime(startTime)
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'endTime')) {
      const endTime = String(payload.endTime)
      fields.endTime = endTime
      validateHourLogTime(endTime)
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'hours')) {
      fields.hours = Number(payload.hours)
      validateHourLogHours(fields.hours as number)
    }
    if (typeof fields.startTime === 'string' && typeof fields.endTime === 'string') {
      validateHourLogTimes({ startTime: fields.startTime, endTime: fields.endTime })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'activity')) fields.activity = String(payload.activity)
    return fields
  }

  private async applyOperation(
    userId: number,
    op: SyncOperationInput,
    db: DbClient = this.prisma,
  ): Promise<SyncOperationResult> {
    if (op.entity !== 'hourLog') {
      return { clientOpId: op.clientOpId, status: 'rejected', server: null, reason: 'entidad no sincronizable desde el cliente' }
    }
    if (op.op === 'create') return this.applyCreateOperation(userId, op, db)
    return this.applyExistingOperation(userId, op, db)
  }

  private async applyCreateOperation(
    userId: number,
    op: SyncOperationInput,
    db: DbClient,
  ): Promise<SyncOperationResult> {
    const placement = await db.placement.findUnique({ where: { id: Number(op.payload.placementId) } })
    if (!placement || placement.studentId !== userId) {
      return { clientOpId: op.clientOpId, status: 'rejected', server: null, reason: 'el placement no pertenece al usuario' }
    }

    const fields = this.extractHourLogFields(op.payload as Record<string, unknown>, placement)
    const created = await db.hourLog.create({
      data: {
        placementId: Number(op.payload.placementId),
        ...fields,
        status: 'SUBMITTED',
      },
    })
    return { clientOpId: op.clientOpId, status: 'applied', server: created as never, reason: null }
  }

  private async applyExistingOperation(
    userId: number,
    op: SyncOperationInput,
    db: DbClient,
  ): Promise<SyncOperationResult> {
    const existing = await db.hourLog.findUnique({
      where: { id: Number(op.payload.id) },
      include: { placement: true },
    })
    if (!existing || existing.placement.studentId !== userId) {
      return { clientOpId: op.clientOpId, status: 'rejected', server: null, reason: 'el registro no pertenece al usuario' }
    }

    if (op.op === 'update') return this.applyUpdateOperation(op, existing, db)

    const deleted = await db.hourLog.update({
      where: { id: Number(op.payload.id) },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    })
    return { clientOpId: op.clientOpId, status: 'applied', server: deleted as never, reason: null }
  }

  private async applyUpdateOperation(
    op: SyncOperationInput,
    existing: {
      id: number
      placement: { studentId: number; startDate: Date; endDate: Date | null }
      status: HourLogStatus
      updatedAt: Date
    },
    db: DbClient,
  ): Promise<SyncOperationResult> {
    // E1-04: el servidor conserva la autoridad cuando el tutor ya resolvió el registro.
    const resolvedReason = this.resolvedStatusReason(existing.status)
    if (resolvedReason) return this.rejectedUpdateResult(op.clientOpId, existing, resolvedReason)

    // E1-04: solo una edición de cliente más reciente puede reemplazar la copia del servidor.
    const timestampRejection = this.updateTimestampRejection(op, existing)
    if (timestampRejection) return timestampRejection

    const fields = this.extractHourLogUpdateFields(op.payload as Record<string, unknown>, existing.placement)
    return this.updateHourLogAtomically(op, existing, fields, db)
  }

  private resolvedStatusReason(status: HourLogStatus): string | null {
    if (status === HourLogStatus.APPROVED) return 'el tutor ya aprobó este registro de horas; no se puede editar'
    if (status === HourLogStatus.REJECTED) return 'el tutor ya rechazó este registro de horas; no se puede editar'
    return null
  }

  private updateTimestampRejection(
    op: SyncOperationInput,
    existing: { updatedAt: Date },
  ): SyncOperationResult | null {
    // Sin un updatedAt de cliente parseable, la comparación con el servidor no es confiable.
    const rawClientUpdatedAt = op.payload.updatedAt
    const clientUpdatedAt =
      typeof rawClientUpdatedAt === 'string' || rawClientUpdatedAt instanceof Date
        ? new Date(String(rawClientUpdatedAt))
        : null
    if (!clientUpdatedAt || Number.isNaN(clientUpdatedAt.getTime())) {
      return this.rejectedUpdateResult(op.clientOpId, existing, 'updatedAt inválido en la operación')
    }

    const serverUpdatedAt = new Date(existing.updatedAt)
    if (Number.isNaN(serverUpdatedAt.getTime())) {
      return this.rejectedUpdateResult(op.clientOpId, existing, 'updatedAt inválido en el servidor')
    }
    if (clientUpdatedAt.getTime() <= serverUpdatedAt.getTime()) {
      return this.rejectedUpdateResult(op.clientOpId, existing, 'existe una versión más reciente en el servidor')
    }
    return null
  }

  private async updateHourLogAtomically(
    op: SyncOperationInput,
    existing: { id: number },
    fields: Record<string, unknown>,
    db: DbClient,
  ): Promise<SyncOperationResult> {
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
      if (!this.isMissingRecordError(err)) throw err
      return this.recoverAtomicUpdateConflict(op, existing, db)
    }
  }

  private isMissingRecordError(err: unknown): boolean {
    return (
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') ||
      (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025')
    )
  }

  private async recoverAtomicUpdateConflict(
    op: SyncOperationInput,
    existing: { id: number },
    db: DbClient,
  ): Promise<SyncOperationResult> {
    const current = await db.hourLog.findUnique({ where: { id: Number(op.payload.id) } })
    return {
      clientOpId: op.clientOpId,
      status: 'rejected',
      server: (current ?? existing) as unknown as Record<string, unknown>,
      reason: this.atomicUpdateConflictReason(current?.status),
    }
  }

  private atomicUpdateConflictReason(status: HourLogStatus | undefined): string {
    if (status === HourLogStatus.APPROVED) {
      return 'el tutor aprobó este registro de horas mientras se procesaba la edición; no se puede editar'
    }
    if (status === HourLogStatus.REJECTED) {
      return 'el tutor rechazó este registro de horas mientras se procesaba la edición; no se puede editar'
    }
    return 'el registro cambió de estado durante la edición'
  }

  private rejectedUpdateResult(
    clientOpId: string,
    existing: object,
    reason: string,
  ): SyncOperationResult {
    return {
      clientOpId,
      status: 'rejected',
      server: existing as Record<string, unknown>,
      reason,
    }
  }
}
