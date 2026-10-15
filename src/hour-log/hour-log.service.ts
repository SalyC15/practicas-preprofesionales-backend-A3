import { Injectable, Optional } from '@nestjs/common'
import { HourLogStatus, Role } from '@prisma/client'
import { InstitutionTimezoneConfig } from '../common/institution-timezone.config'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateHourLogDto } from './dto/create-hour-log.dto'
import { HourLogAccess } from './hour-log.access'
import { HourLogEntry } from './hour-log.entry'
import { HourLogExport } from './hour-log.export'
import { HourLogReport, type WeeklyHourSummary } from './hour-log.report'

@Injectable()
export class HourLogService {
  private readonly entry: HourLogEntry
  private readonly access: HourLogAccess
  private readonly report: HourLogReport
  private readonly exporter: HourLogExport

  constructor(
    private readonly prisma: PrismaService,
    private readonly institutionTimezone: InstitutionTimezoneConfig = new InstitutionTimezoneConfig(),
    @Optional() entry?: HourLogEntry,
    @Optional() access?: HourLogAccess,
    @Optional() report?: HourLogReport,
    @Optional() exporter?: HourLogExport,
  ) {
    this.entry = entry ?? new HourLogEntry(prisma, institutionTimezone)
    this.access = access ?? new HourLogAccess(prisma)
    this.report = report ?? new HourLogReport(prisma)
    this.exporter = exporter ?? new HourLogExport(prisma)
  }

  create(dto: CreateHourLogDto, studentId: number) {
    return this.entry.create(dto, studentId)
  }

  assertPlacementAccess(placementId: number, userId: number, role: Role) {
    return this.access.assertPlacementAccess(placementId, userId, role)
  }

  listForPlacement(placementId: number) {
    return this.access.listForPlacement(placementId)
  }

  review(id: number, status: HourLogStatus, reviewerId: number, note?: string, reviewerRole?: Role) {
    return this.entry.review(id, status, reviewerId, note, reviewerRole)
  }

  approvedHours(placementId: number) {
    return this.report.approvedHours(placementId)
  }

  progressReport(placementId: number) {
    return this.report.progressReport(placementId)
  }

  weeklySummary(placementId: number): Promise<WeeklyHourSummary[]> {
    return this.report.weeklySummary(placementId)
  }

  exportRows(placementId: number) {
    return this.exporter.exportRows(placementId)
  }
}
