import { Injectable, NotFoundException } from '@nestjs/common'
import { HourLogStatus } from '@prisma/client'
import { getUtcCalendarDayDistance } from '../common/calendar-date'
import { PrismaService } from '../prisma/prisma.service'

export interface WeeklyHourSummary {
  week: string
  approvedHours: number
  submittedHours: number
  logsCount: number
  expectedHoursPercentage: number
}

@Injectable()
export class HourLogReport {
  constructor(private readonly prisma: PrismaService) {}

  async approvedHours(placementId: number): Promise<number> {
    const result = await this.prisma.hourLog.aggregate({
      where: { placementId, status: HourLogStatus.APPROVED, deletedAt: null },
      _sum: { hours: true },
    })
    return result._sum.hours ?? 0
  }

  async progressReport(placementId: number) {
    const placement = await this.prisma.placement.findUnique({ where: { id: placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    const approved = await this.approvedHours(placementId)
    const pending = await this.prisma.hourLog.count({
      where: { placementId, status: HourLogStatus.SUBMITTED, deletedAt: null },
    })
    return {
      placementId,
      requiredHours: placement.requiredHours,
      approvedHours: approved,
      pendingLogs: pending,
      percentage: Math.round((approved / placement.requiredHours) * 100),
    }
  }

  async weeklySummary(placementId: number): Promise<WeeklyHourSummary[]> {
    const placement = await this.prisma.placement.findUnique({ where: { id: placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    const logs = await this.prisma.hourLog.findMany({
      where: { placementId, deletedAt: null },
      orderBy: { date: 'asc' },
    })
    const totalDays = Math.max(1, getUtcCalendarDayDistance(placement.startDate, placement.endDate))
    const expectedHoursPerWeek = placement.requiredHours / Math.max(1, Math.ceil(totalDays / 7))
    const buckets = new Map<string, Omit<WeeklyHourSummary, 'week' | 'expectedHoursPercentage'>>()

    for (const log of logs) {
      if (log.status !== HourLogStatus.APPROVED && log.status !== HourLogStatus.SUBMITTED) continue
      const week = this.isoWeekLabel(log.date)
      const bucket = buckets.get(week) ?? { approvedHours: 0, submittedHours: 0, logsCount: 0 }
      if (log.status === HourLogStatus.APPROVED) bucket.approvedHours += log.hours
      else bucket.submittedHours += log.hours
      bucket.logsCount += 1
      buckets.set(week, bucket)
    }

    return [...buckets.entries()]
      .map(([week, bucket]) => ({
        week,
        ...bucket,
        expectedHoursPercentage:
          expectedHoursPerWeek > 0 ? Math.round((bucket.approvedHours / expectedHoursPerWeek) * 100) : 0,
      }))
      .sort((a, b) => a.week.localeCompare(b.week))
  }

  private isoWeekLabel(date: Date): string {
    const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    const isoDayNumber = copy.getUTCDay() === 0 ? 7 : copy.getUTCDay()
    copy.setUTCDate(copy.getUTCDate() + 4 - isoDayNumber)
    const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1))
    const daysSinceYearStart = (copy.getTime() - yearStart.getTime()) / 86400000
    return `${copy.getUTCFullYear()}-W${String(Math.ceil((daysSinceYearStart + 1) / 7)).padStart(2, '0')}`
  }
}
