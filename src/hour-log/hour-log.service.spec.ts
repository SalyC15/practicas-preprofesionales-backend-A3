import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { HourLogStatus, Role } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HourLogService } from './hour-log.service'

const prisma = {
  hourLog: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), aggregate: vi.fn() },
  placement: { findUnique: vi.fn() },
}

const activePlacement = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  studentId: 5,
  tutorId: 7,
  status: 'ACTIVE',
  startDate: new Date('2026-10-01T18:00:00.000Z'),
  endDate: new Date('2026-10-31T18:00:00.000Z'),
  ...overrides,
})

describe('HourLogService', () => {
  let service: HourLogService

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T12:00:00.000Z'))
    vi.stubEnv('INSTITUTION_TIMEZONE', 'America/Guayaquil')
    prisma.placement.findUnique.mockResolvedValue(activePlacement())
    service = new HourLogService(prisma as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('creates an hour log in SUBMITTED for an active placement and stores its calendar day at UTC midnight', async () => {
    prisma.hourLog.create.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))

    const result = await service.create(
      { placementId: 1, date: '2026-10-13', startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Desarrollo de módulo de reportes' } as never,
      5,
    )

    expect(result.status).toBe('SUBMITTED')
    expect(result.hours).toBe(4)
    expect(prisma.hourLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ date: new Date('2026-10-13T00:00:00.000Z') }) }),
    )
  })

  it.each([
    ['2026-10-13', '2026-10-13T00:00:00.000Z'],
    ['2026-10-13T23:30:00-05:00', '2026-10-13T00:00:00.000Z'],
    ['2026-10-14T04:30:00.000Z', '2026-10-13T00:00:00.000Z'],
    ['2026-10-14T06:30:00+02:00', '2026-10-13T00:00:00.000Z'],
    ['2026-10-13T21:30:00+09:00', '2026-10-13T00:00:00.000Z'],
    [new Date('2026-10-14T04:30:00.000Z'), '2026-10-13T00:00:00.000Z'],
  ])('normalizes REST date input %s to the same institutional day', async (input, expected) => {
    await service.create(
      { placementId: 1, date: input, startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Actividad' } as never,
      5,
    )

    expect(prisma.hourLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ date: new Date(expected) }) }),
    )
  })

  it('rejects an impossible pure calendar date without writing a row', async () => {
    await expect(
      service.create(
        { placementId: 1, date: '2026-02-30', startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Actividad' } as never,
        5,
      ),
    ).rejects.toThrow(BadRequestException)
    expect(prisma.hourLog.create).not.toHaveBeenCalled()
  })

  it('rejects a future institutional date and accepts the current day at the UTC midnight boundary', async () => {
    vi.setSystemTime(new Date('2026-10-14T01:00:00.000Z'))

    await expect(
      service.create(
        { placementId: 1, date: '2026-10-14', startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Actividad' } as never,
        5,
      ),
    ).rejects.toThrow('No se pueden registrar horas con fecha futura')
    expect(prisma.hourLog.create).not.toHaveBeenCalled()

    await service.create(
      { placementId: 1, date: '2026-10-13', startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Actividad' } as never,
      5,
    )
    expect(prisma.hourLog.create).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['2026-09-30', '2026-10-01', '2026-10-31'],
    ['2026-11-01', '2026-10-01', '2026-10-31'],
  ])('rejects %s outside the inclusive placement range %s to %s without writing', async (input, start, end) => {
    vi.setSystemTime(new Date('2026-11-15T12:00:00.000Z'))
    prisma.placement.findUnique.mockResolvedValue(activePlacement({
      startDate: new Date(`${start}T18:00:00.000Z`),
      endDate: new Date(`${end}T18:00:00.000Z`),
    }))

    await expect(
      service.create(
        { placementId: 1, date: input, startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Actividad' } as never,
        5,
      ),
    ).rejects.toThrow(`La fecha del registro (${input}) está fuera del rango válido de la práctica (${start} a ${end}).`)
    expect(prisma.hourLog.create).not.toHaveBeenCalled()
  })

  it('accepts both inclusive placement date boundaries', async () => {
    vi.setSystemTime(new Date('2026-11-15T12:00:00.000Z'))
    prisma.placement.findUnique.mockResolvedValue(activePlacement())

    for (const date of ['2026-10-01', '2026-10-31']) {
      await service.create(
        { placementId: 1, date, startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Actividad' } as never,
        5,
      )
    }

    expect(prisma.hourLog.create).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['America/Guayaquil', '2026-10-13T00:00:00.000Z'],
    ['Europe/Madrid', '2026-10-14T00:00:00.000Z'],
  ])('uses configured timezone %s when normalizing an instant at the day boundary', async (timeZone, expected) => {
    vi.stubEnv('INSTITUTION_TIMEZONE', timeZone)
    vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'))
    service = new HourLogService(prisma as never)
    prisma.placement.findUnique.mockResolvedValue(activePlacement({
      startDate: new Date('2026-10-12T18:00:00.000Z'),
      endDate: new Date('2026-10-15T18:00:00.000Z'),
    }))

    await service.create(
      { placementId: 1, date: '2026-10-14T02:00:00.000Z', startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Actividad' } as never,
      5,
    )

    expect(prisma.hourLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ date: new Date(expected) }) }),
    )
  })

  it('rejects an invalid configured timezone', () => {
    vi.stubEnv('INSTITUTION_TIMEZONE', 'America/Nowhere')
    expect(() => new HourLogService(prisma as never)).toThrow(/INSTITUTION_TIMEZONE.*inválida/)
  })

  it('rejects an hour log with more hours than the service allows', async () => {
    prisma.placement.findUnique.mockResolvedValue(activePlacement())

    await expect(
      service.create(
        { placementId: 1, date: new Date('2026-10-13'), startTime: '08:00', endTime: '20:00', hours: 11, activity: 'Jornada larga de soporte' },
        5,
      ),
    ).rejects.toThrow(BadRequestException)
  })

  it('approves a submitted hour log when reviewer is the assigned tutor without writing its stored date', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 99,
      date: new Date('2026-10-13T23:30:00.000Z'),
      placementId: 1,
      status: 'SUBMITTED',
      version: 1,
      placement: { id: 1, tutorId: 7 },
    })
    prisma.hourLog.update.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))

    const result = await service.review(99, HourLogStatus.APPROVED, 7, 'ok', Role.TUTOR)

    expect(result.status).toBe('APPROVED')
    expect(result.reviewedById).toBe(7)
    expect(prisma.hourLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ date: expect.anything() }) }),
    )
  })

  it('returns an existing non-midnight row unchanged in list and preserves its UTC day in export', async () => {
    const log = {
      id: 99,
      date: new Date('2026-10-13T23:30:00.000Z'),
      placementId: 1,
      startTime: '08:00',
      endTime: '12:00',
      hours: 4,
      activity: 'Actividad',
      status: 'SUBMITTED',
      reviewedById: null,
    }
    prisma.hourLog.findMany.mockResolvedValue([log])

    await expect(service.listForPlacement(1)).resolves.toEqual([log])
    const rows = await service.exportRows(1)

    expect(rows[1][1]).toBe('2026-10-13')
  })

  it('groups legacy non-midnight records by their stored UTC day in weekly summaries', async () => {
    const previousTimeZone = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    prisma.placement.findUnique.mockResolvedValue({
      startDate: new Date('2026-01-05T00:00:00.000Z'),
      endDate: new Date('2026-01-12T00:00:00.000Z'),
      requiredHours: 40,
    })
    prisma.hourLog.findMany.mockResolvedValue([
      {
        date: new Date('2026-01-05T00:30:00.000Z'),
        status: 'SUBMITTED',
        hours: 4,
      },
    ])

    try {
      const summary = await service.weeklySummary(1)
      expect(summary[0].week).toBe('2026-W02')
      expect(summary[0].submittedHours).toBe(4)
    } finally {
      if (previousTimeZone === undefined) delete process.env.TZ
      else process.env.TZ = previousTimeZone
    }
  })
  it('rejects approval when tutor is not assigned to the placement', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({ id: 99, placementId: 1, status: 'SUBMITTED', version: 1, placement: { id: 1, tutorId: 7 } })
    await expect(service.review(99, HourLogStatus.APPROVED, 999, 'intento ajeno', Role.TUTOR)).rejects.toThrow(ForbiddenException)
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  it('allows coordination to review hour logs', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({ id: 99, placementId: 1, status: 'SUBMITTED', version: 1, placement: { id: 1, tutorId: 7 } })
    prisma.hourLog.update.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))
    const result = await service.review(99, HourLogStatus.APPROVED, 1, 'aprobado', Role.COORDINATOR)
    expect(result.status).toBe('APPROVED')
  })

  it('throws NotFoundException when hour log does not exist', async () => {
    prisma.hourLog.findUnique.mockResolvedValue(null)
    await expect(service.review(999, HourLogStatus.APPROVED, 7, 'ok', Role.TUTOR)).rejects.toThrow(NotFoundException)
  })

  it('throws BadRequestException when hour log is not submitted', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({ id: 99, placementId: 1, status: 'DRAFT', version: 1, placement: { id: 1, tutorId: 7 } })
    await expect(service.review(99, HourLogStatus.APPROVED, 7, 'ok', Role.TUTOR)).rejects.toThrow(BadRequestException)
  })
})
