import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { DocumentKind, DocumentStatus, HourLogStatus, PlacementStatus, Role } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { UploadDocumentDto } from './dto/upload-document.dto'

const REQUIRED_DOCS: DocumentKind[] = [DocumentKind.AGREEMENT, DocumentKind.INSURANCE]

@Injectable()
export class PlacementService {
  constructor(private readonly prisma: PrismaService) {}

  listTutors() {
    return this.prisma.user.findMany({
      where: { role: Role.TUTOR },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: 'asc' },
    })
  }

  async createFromApplication(applicationId: number, tutorId: number) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { offer: true },
    })
    if (!application) throw new NotFoundException('postulación no encontrada')
    if (application.status !== 'ACCEPTED') {
      throw new BadRequestException('la postulación no está aceptada')
    }

    const active = await this.prisma.placement.findFirst({
      where: { studentId: application.studentId, status: PlacementStatus.ACTIVE },
    })
    if (active) throw new BadRequestException('el estudiante ya tiene un placement activo')

    return this.prisma.placement.create({
      data: {
        applicationId,
        studentId: application.studentId,
        tutorId,
        companyId: application.offer.companyId,
        startDate: application.offer.periodStart,
        endDate: application.offer.periodEnd,
        requiredHours: application.offer.requiredHours,
        status: PlacementStatus.PENDING_DOCS,
      },
    })
  }

  async activate(id: number) {
    const placement = await this.prisma.placement.findUnique({
      where: { id },
      include: { documents: true },
    })
    if (!placement) throw new NotFoundException('placement no encontrado')
    if (placement.status !== PlacementStatus.PENDING_DOCS) {
      throw new BadRequestException('solo se activan placements en PENDING_DOCS')
    }

    const missing = REQUIRED_DOCS.filter(
      (kind) => !placement.documents.some((d) => d.kind === kind && d.status === DocumentStatus.VALIDATED),
    )
    if (missing.length > 0) {
      throw new BadRequestException(`faltan documentos validados: ${missing.join(', ')}`)
    }

    return this.prisma.placement.update({
      where: { id },
      data: { status: PlacementStatus.ACTIVE },
    })
  }

  findForStudent(studentId: number) {
    return this.prisma.placement.findFirst({
      where: { studentId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        company: true,
        // `tutor: true` filtraría el hash de contraseña del tutor en la respuesta.
        tutor: { select: { id: true, fullName: true, email: true } },
        documents: true,
      },
    })
  }

  async addDocument(placementId: number, dto: UploadDocumentDto, uploadedById: number, role: Role) {
    const placement = await this.prisma.placement.findUnique({ where: { id: placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    if (role !== Role.COORDINATOR && placement.studentId !== uploadedById) {
      throw new ForbiddenException('el placement no es tuyo')
    }

    return this.prisma.document.create({
      data: { ...dto, placementId, uploadedById, status: DocumentStatus.PENDING },
    })
  }

  async getSchedule(id: number) {
    const placement = await this.prisma.placement.findUnique({
      where: { id },
      include: {
        company: true,
        hourLogs: {
          where: { deletedAt: null, status: { not: HourLogStatus.REJECTED } },
          orderBy: { date: 'asc' },
        },
      },
    })
    if (!placement) throw new NotFoundException('placement no encontrado')

    const requiredHours = Math.max(0, placement.requiredHours || 0)
    const startTime = '08:00'
    const endTime = '12:00'
    const dailyHours = 4
    const workDays = [1, 2, 3, 4, 5] // Lun a Vie

    const logsByDate = new Map<string, { status: HourLogStatus; hours: number }>()
    for (const log of placement.hourLogs) {
      const dateStr = log.date.toISOString().slice(0, 10)
      if (!logsByDate.has(dateStr)) {
        logsByDate.set(dateStr, { status: log.status, hours: log.hours })
      }
    }

    const current = new Date(placement.startDate.getTime())
    current.setUTCHours(0, 0, 0, 0)

    let accumulatedHours = 0
    let sessionIndex = 1
    const sessions = []
    let safetyCounter = 0

    while (accumulatedHours < requiredHours && safetyCounter < 365) {
      safetyCounter++
      const dayOfWeek = current.getUTCDay()

      if (workDays.includes(dayOfWeek)) {
        const year = current.getUTCFullYear()
        const month = String(current.getUTCMonth() + 1).padStart(2, '0')
        const day = String(current.getUTCDate()).padStart(2, '0')
        const dateStr = `${year}-${month}-${day}`

        const remainingHours = requiredHours - accumulatedHours
        const sessionHours = Math.min(dailyHours, remainingHours)
        const existing = logsByDate.get(dateStr)

        let status = 'PENDING'
        if (existing) {
          if (existing.status === HourLogStatus.APPROVED) status = 'APPROVED'
          else status = 'CONFIRMED'
        }

        sessions.push({
          date: dateStr,
          startTime,
          endTime,
          hours: sessionHours,
          activity: `Práctica en ${placement.company.name}`,
          sessionIndex,
          status,
        })

        accumulatedHours += sessionHours
        sessionIndex++
      }

      current.setUTCDate(current.getUTCDate() + 1)
    }

    const confirmedSessions = sessions.filter((s) => s.status === 'CONFIRMED' || s.status === 'APPROVED').length
    const confirmedHours = sessions
      .filter((s) => s.status === 'CONFIRMED' || s.status === 'APPROVED')
      .reduce((sum, s) => sum + s.hours, 0)

    const startDateStr = placement.startDate.toISOString().slice(0, 10)
    const endDateStr = sessions.length > 0 ? sessions[sessions.length - 1].date : startDateStr

    return {
      requiredHours,
      plannedHours: accumulatedHours,
      confirmedHours,
      totalSessions: sessions.length,
      confirmedSessions,
      dailyHours,
      startDate: startDateStr,
      endDate: endDateStr,
      sessions,
    }
  }
}
