import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'
import { PlacementService } from './placement.service'

const prisma = {
  placement: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  document: { create: vi.fn() },
  application: { findUnique: vi.fn() },
}

describe('PlacementService.activate', () => {
  let service: PlacementService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new PlacementService(prisma as never)
  })

  it('activates when AGREEMENT and INSURANCE are validated', async () => {
    prisma.placement.findUnique.mockResolvedValue({
      id: 1,
      status: 'PENDING_DOCS',
      documents: [
        { kind: 'AGREEMENT', status: 'VALIDATED' },
        { kind: 'INSURANCE', status: 'VALIDATED' },
      ],
    })
    prisma.placement.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }))

    const result = await service.activate(1)

    expect(result.status).toBe('ACTIVE')
  })

  it('refuses to activate when the insurance is missing', async () => {
    prisma.placement.findUnique.mockResolvedValue({
      id: 1,
      status: 'PENDING_DOCS',
      documents: [{ kind: 'AGREEMENT', status: 'VALIDATED' }],
    })

    await expect(service.activate(1)).rejects.toThrow(BadRequestException)
  })

  it('calculates company schedule covering required hours without weekends', async () => {
    prisma.placement.findUnique.mockResolvedValue({
      id: 10,
      requiredHours: 12,
      startDate: new Date('2026-10-12T00:00:00.000Z'), // Lunes
      company: { name: 'Acme Corp' },
      hourLogs: [
        {
          date: new Date('2026-10-12T00:00:00.000Z'),
          status: 'APPROVED',
          hours: 4,
        },
      ],
    })

    const schedule = await service.getSchedule(10, 1, Role.COORDINATOR)

    expect(schedule.requiredHours).toBe(12)
    expect(schedule.plannedHours).toBe(12)
    expect(schedule.totalSessions).toBe(3)
    expect(schedule.confirmedSessions).toBe(1)
    expect(schedule.confirmedHours).toBe(4)
    expect(schedule.sessions[0].status).toBe('APPROVED')
    expect(schedule.sessions[1].status).toBe('PENDING')
  })
})
