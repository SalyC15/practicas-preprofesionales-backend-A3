import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { HourLogStatus, Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HourLogService } from './hour-log.service'

const prisma = {
  hourLog: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), aggregate: vi.fn() },
  placement: { findUnique: vi.fn() },
}

describe('HourLogService', () => {
  let service: HourLogService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new HourLogService(prisma as never)
  })

  it('creates an hour log in SUBMITTED for an active placement', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, tutorId: 7, status: 'ACTIVE' })
    prisma.hourLog.create.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))

    const result = await service.create(
      { placementId: 1, date: new Date('2026-04-01'), startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Desarrollo de módulo de reportes' },
      5,
    )

    expect(result.status).toBe('SUBMITTED')
    expect(result.hours).toBe(4)
  })

  it('rejects an hour log with more hours than the service allows', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, tutorId: 7, status: 'ACTIVE' })

    await expect(
      service.create(
        { placementId: 1, date: new Date('2026-04-01'), startTime: '08:00', endTime: '20:00', hours: 11, activity: 'Jornada larga de soporte' },
        5,
      ),
    ).rejects.toThrow(BadRequestException)
  })

  it('approves a submitted hour log when reviewer is the assigned tutor', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 99,
      placementId: 1,
      status: 'SUBMITTED',
      version: 1,
      placement: { id: 1, tutorId: 7 },
    })
    prisma.hourLog.update.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))

    const result = await service.review(99, HourLogStatus.APPROVED, 7, 'ok', Role.TUTOR)

    expect(result.status).toBe('APPROVED')
    expect(result.reviewedById).toBe(7)
  })

  it('rejects approval when tutor is not assigned to the placement (403 Forbidden)', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 99,
      placementId: 1,
      status: 'SUBMITTED',
      version: 1,
      placement: { id: 1, tutorId: 7 },
    })

    await expect(
      service.review(99, HourLogStatus.APPROVED, 999, 'intento ajeno', Role.TUTOR),
    ).rejects.toThrow(ForbiddenException)
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  it('rejects rejection when tutor is not assigned to the placement (403 Forbidden)', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 99,
      placementId: 1,
      status: 'SUBMITTED',
      version: 1,
      placement: { id: 1, tutorId: 7 },
    })

    await expect(
      service.review(99, HourLogStatus.REJECTED, 999, 'intento ajeno', Role.TUTOR),
    ).rejects.toThrow(ForbiddenException)
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  it('allows the assigned tutor to reject a submitted hour log', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 99,
      placementId: 1,
      status: 'SUBMITTED',
      version: 1,
      placement: { id: 1, tutorId: 7 },
    })
    prisma.hourLog.update.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))

    const result = await service.review(99, HourLogStatus.REJECTED, 7, 'rechazado por falta de evidencia', Role.TUTOR)

    expect(result.status).toBe('REJECTED')
    expect(result.reviewedById).toBe(7)
    expect(result.reviewNote).toBe('rechazado por falta de evidencia')
  })

  it('preserves coordination permissions in assertPlacementAccess', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 10, studentId: 5, tutorId: 7, status: 'ACTIVE' })

    // Coordinador siempre tiene acceso global
    await expect(service.assertPlacementAccess(10, 999, Role.COORDINATOR)).resolves.toBeUndefined()

    // Tutor asignado tiene acceso
    await expect(service.assertPlacementAccess(10, 7, Role.TUTOR)).resolves.toBeUndefined()

    // Tutor no asignado recibe 403 Forbidden
    await expect(service.assertPlacementAccess(10, 888, Role.TUTOR)).rejects.toThrow(ForbiddenException)
  })

  it('allows coordination to review hour logs at service level', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 99,
      placementId: 1,
      status: 'SUBMITTED',
      version: 1,
      placement: { id: 1, tutorId: 7 },
    })
    prisma.hourLog.update.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))

    const result = await service.review(99, HourLogStatus.APPROVED, 1, 'aprobado por coordinacion', Role.COORDINATOR)

    expect(result.status).toBe('APPROVED')
    expect(result.reviewedById).toBe(1)
  })

  it('throws NotFoundException when hour log does not exist', async () => {
    prisma.hourLog.findUnique.mockResolvedValue(null)

    await expect(service.review(999, HourLogStatus.APPROVED, 7, 'ok', Role.TUTOR)).rejects.toThrow(
      NotFoundException,
    )
  })

  it('throws BadRequestException when hour log is not in SUBMITTED status', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 99,
      placementId: 1,
      status: 'DRAFT',
      version: 1,
      placement: { id: 1, tutorId: 7 },
    })

    await expect(service.review(99, HourLogStatus.APPROVED, 7, 'ok', Role.TUTOR)).rejects.toThrow(
      BadRequestException,
    )
  })
})
