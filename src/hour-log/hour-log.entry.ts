import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { HourLogStatus, PlacementStatus, Role } from '@prisma/client'
import { CalendarDateError, validateHourLogCalendarDate } from '../common/calendar-date'
import { InstitutionTimezoneConfig } from '../common/institution-timezone.config'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateHourLogDto } from './dto/create-hour-log.dto'
import { HourLogNotification } from './hour-log.notification'
import { HourLogValidationError, validateHourLogInput } from './hour-log.validation'

@Injectable()
export class HourLogEntry {
  constructor(
    private readonly prisma: PrismaService,
    private readonly institutionTimezone: InstitutionTimezoneConfig,
    private readonly notification: HourLogNotification = new HourLogNotification(),
  ) {}

  async create(dto: CreateHourLogDto, studentId: number) {
    const placement = await this.prisma.placement.findUnique({ where: { id: dto.placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    if (placement.studentId !== studentId) throw new BadRequestException('el placement no es tuyo')
    if (placement.status !== PlacementStatus.ACTIVE) {
      throw new BadRequestException('el placement no está activo')
    }

    try {
      validateHourLogInput(dto)
    } catch (error) {
      if (error instanceof HourLogValidationError) throw new BadRequestException(error.message)
      throw error
    }

    let normalizedDate: Date
    try {
      normalizedDate = validateHourLogCalendarDate(
        dto.date,
        placement,
        this.institutionTimezone.timeZone,
        this.institutionTimezone.now(),
      ).utcMidnight
    } catch (error) {
      if (error instanceof CalendarDateError) throw new BadRequestException(error.message)
      throw error
    }

    const created = await this.prisma.hourLog.create({
      data: {
        placementId: dto.placementId,
        date: normalizedDate,
        startTime: dto.startTime,
        endTime: dto.endTime,
        hours: dto.hours,
        activity: dto.activity,
        status: HourLogStatus.SUBMITTED,
      },
    })
    this.notification.notifyTutor(placement.tutorId, created.id)
    return created
  }

  async review(id: number, status: HourLogStatus, reviewerId: number, note?: string, reviewerRole?: Role) {
    const log = await this.prisma.hourLog.findUnique({
      where: { id },
      include: { placement: true },
    })
    if (!log) throw new NotFoundException('registro de horas no encontrado')
    if (!log.placement) throw new NotFoundException('placement no encontrado')

    const isAssignedTutor = log.placement.tutorId === reviewerId
    const isCoordinator = reviewerRole === Role.COORDINATOR
    if (!isAssignedTutor && !isCoordinator) {
      throw new ForbiddenException('solo el tutor asignado puede revisar este registro de horas')
    }

    if (log.status !== HourLogStatus.SUBMITTED) {
      throw new BadRequestException('solo se revisan registros en SUBMITTED')
    }
    return this.prisma.hourLog.update({
      where: { id },
      data: {
        status,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNote: note,
        version: { increment: 1 },
      },
    })
  }
}
