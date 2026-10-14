import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { getUtcCalendarDate } from '../src/common/calendar-date'

const prisma = new PrismaClient()

type DatedValue = { id: number; field: string; date: Date }

function isUtcMidnight(date: Date): boolean {
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0
}

function reportNonMidnight(label: string, values: DatedValue[]): void {
  const nonMidnight = values.filter(({ date }) => !isUtcMidnight(date))
  console.log(`${label}: ${values.length} filas inspeccionadas; ${nonMidnight.length} con hora distinta de medianoche UTC`)
  for (const value of nonMidnight) {
    console.log(`  id=${value.id} ${value.field}=${value.date.toISOString()} día-UTC=${getUtcCalendarDate(value.date)}`)
  }
}

async function main(): Promise<void> {
  const [hourLogs, placements] = await Promise.all([
    prisma.hourLog.findMany({ select: { id: true, date: true } }),
    prisma.placement.findMany({ select: { id: true, startDate: true, endDate: true } }),
  ])

  reportNonMidnight(
    'HourLog.date',
    hourLogs.map(({ id, date }) => ({ id, field: 'date', date })),
  )
  reportNonMidnight(
    'Placement.startDate/endDate',
    placements.flatMap(({ id, startDate, endDate }) => [
      { id, field: 'startDate', date: startDate },
      { id, field: 'endDate', date: endDate },
    ]),
  )
}

void main()
  .catch((error: unknown) => {
    console.error('No se pudo completar la auditoría de fechas', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
