import { Injectable } from '@nestjs/common'
import { DocumentKind, DocumentStatus, HourLogStatus, Prisma } from '@prisma/client'
import { pageResult } from '../common/page-query.dto'
import type { AccreditationPageQueryDto } from './dto/accreditation-query.dto'
import { PrismaService } from '../prisma/prisma.service'
import { type AccreditationResult, calculateAccreditationStatus } from './accreditation'

@Injectable()
export class AccreditationService {
  constructor(private readonly prisma: PrismaService) {}

  async reportPage(query: AccreditationPageQueryDto) {
    const [year, term] = query.period.split('-')
    const where = { startDate: { gte: new Date(Date.UTC(Number(year), term === '1' ? 0 : 6, 1)),
      lt: new Date(Date.UTC(Number(year), term === '1' ? 6 : 12, 1)) }, deletedAt: null }
    return this.prisma.$transaction(async (tx) => {
      const summary = { accredited: 0, observations: 0, pending: 0, notAccredited: 0 }
      const items: AccreditationResult[] = []
      let total = 0
      let cursor: number | undefined
      while (true) {
        const batch = await tx.placement.findMany({ where, take: 250, orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: { student: { select: { fullName: true } },
            documents: { where: { deletedAt: null, status: DocumentStatus.VALIDATED }, distinct: ['kind'], select: { kind: true } },
            evaluations: { where: { deletedAt: null, kind: { in: ['TUTOR', 'COMPANY'] } }, orderBy: { submittedAt: 'desc' }, distinct: ['kind'], select: { kind: true, scores: true } } } })
        if (batch.length === 0) break
        const sums = await tx.hourLog.groupBy({ by: ['placementId', 'status'], where: { placementId: { in: batch.map((p) => p.id) },
          deletedAt: null, status: { in: [HourLogStatus.APPROVED, HourLogStatus.SUBMITTED] } }, _sum: { hours: true } })
        const totals = new Map(sums.map((row) => [`${row.placementId}:${row.status}`, row._sum.hours ?? 0]))
        for (const placement of batch) {
          const score = (kind: string) => {
            const entry = placement.evaluations.find((e) => e.kind === kind)
            if (!entry) return null
            const values = entry.scores as { technical: number; communication: number; punctuality: number }
            return (values.technical + values.communication + values.punctuality) / 3
          }
          const result = calculateAccreditationStatus({ placementId: placement.id, studentName: placement.student.fullName,
            requiredHours: placement.requiredHours, approvedHours: totals.get(`${placement.id}:APPROVED`) ?? 0,
            pendingHours: totals.get(`${placement.id}:SUBMITTED`) ?? 0,
            hasAgreement: placement.documents.some((d) => d.kind === 'AGREEMENT'),
            hasInsurance: placement.documents.some((d) => d.kind === 'INSURANCE'),
            hasFinalReport: placement.documents.some((d) => d.kind === 'REPORT'),
            tutorEvaluationScore: score('TUTOR'), companyEvaluationScore: score('COMPANY'), placementStatus: placement.status })
          if (result.level === 'ACREDITADO') summary.accredited++
          if (result.level === 'ACREDITADO_CON_OBSERVACIONES') { summary.accredited++; summary.observations++ }
          if (result.level === 'PENDIENTE') summary.pending++
          if (result.level === 'NO_ACREDITADO') summary.notAccredited++
          if (total >= (query.page - 1) * query.pageSize && items.length < query.pageSize) items.push(result)
          total++
        }
        cursor = batch[batch.length - 1].id
        if (batch.length < 250) break
      }
      return { ...pageResult(items, total, query), summary }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 })
  }

  async reportForPeriod(period: string): Promise<AccreditationResult[]> {
    const [year, term] = period.split('-')
    const from = new Date(Number(year), term === '1' ? 0 : 6, 1)
    const to = new Date(Number(year), term === '1' ? 6 : 12, 1)

    const placements = await this.prisma.placement.findMany({
      where: { startDate: { gte: from, lt: to }, deletedAt: null },
      include: {
        student: { select: { fullName: true } },
        documents: true,
        evaluations: true,
      },
    })

    const results: AccreditationResult[] = []
    for (const placement of placements) {
      const approved = await this.prisma.hourLog.aggregate({
        where: { placementId: placement.id, status: HourLogStatus.APPROVED, deletedAt: null },
        _sum: { hours: true },
      })
      const pending = await this.prisma.hourLog.aggregate({
        where: { placementId: placement.id, status: HourLogStatus.SUBMITTED, deletedAt: null },
        _sum: { hours: true },
      })

      const validated = (kind: DocumentKind) =>
        placement.documents.some((d) => d.kind === kind && d.status === DocumentStatus.VALIDATED)

      const scoreOf = (kind: 'TUTOR' | 'COMPANY'): number | null => {
        const evaluation = placement.evaluations.find((e) => e.kind === kind)
        if (!evaluation) return null
        const scores = evaluation.scores as { technical: number; communication: number; punctuality: number }
        return (scores.technical + scores.communication + scores.punctuality) / 3
      }

      results.push(
        calculateAccreditationStatus({
          placementId: placement.id,
          studentName: placement.student.fullName,
          requiredHours: placement.requiredHours,
          approvedHours: approved._sum.hours ?? 0,
          pendingHours: pending._sum.hours ?? 0,
          hasAgreement: validated(DocumentKind.AGREEMENT),
          hasInsurance: validated(DocumentKind.INSURANCE),
          hasFinalReport: validated(DocumentKind.REPORT),
          tutorEvaluationScore: scoreOf('TUTOR'),
          companyEvaluationScore: scoreOf('COMPANY'),
          placementStatus: placement.status,
        }),
      )
    }
    return results
  }
}
