import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { validateHourLogInput } from './hour-log.validation'

@Injectable()
export class HourLogExport {
  constructor(private readonly prisma: PrismaService) {}

  async exportRows(placementId: number): Promise<(string | number)[][]> {
    const logs = await this.prisma.hourLog.findMany({
      where: { placementId, deletedAt: null },
      orderBy: { date: 'asc' },
    })
    const rows: (string | number)[][] = [['id', 'fecha', 'inicio', 'fin', 'horas', 'actividad', 'estado', 'revisadoPor']]

    for (const log of logs) {
      try {
        validateHourLogInput(log)
      } catch (error) {
        if (error instanceof Error) throw new BadRequestException(error.message)
        throw error
      }
      rows.push([
        log.id,
        log.date.toISOString().slice(0, 10),
        log.startTime,
        log.endTime,
        log.hours,
        this.escapeCsvField(log.activity),
        log.status,
        log.reviewedById ?? '',
      ])
    }

    const totalHours = logs.reduce((total, log) => total + log.hours, 0)
    rows.push(['', '', '', '', totalHours, 'TOTAL', '', ''])
    return rows
  }

  private escapeCsvField(value: string): string {
    const needsQuoting = value.includes(',') || value.includes('"') || value.includes('\n')
    return needsQuoting ? `"${value.replace(/"/g, '""')}"` : value
  }
}
