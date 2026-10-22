import { type ExecutionContext, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Role } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { EvaluationController } from '../evaluation/evaluation.controller'
import { EvaluationService } from '../evaluation/evaluation.service'
import { PlacementController } from '../placement/placement.controller'
import { PlacementService } from '../placement/placement.service'
import { AccreditationService } from '../placement/accreditation.service'
import { PrismaService } from '../prisma/prisma.service'

const placement = {
  id: 1, studentId: 10, tutorId: 20, companyId: 100,
  requiredHours: 4, startDate: new Date('2026-10-01T00:00:00Z'),
  company: { name: 'Empresa asignada' }, hourLogs: [],
}
const prisma = {
  placement: { findUnique: vi.fn(async ({ where }: { where: { id: number } }) => where.id === 1 ? placement : null) },
  user: { findUnique: vi.fn(async ({ where }: { where: { id: number } }) => {
    if (where.id === 33) return null
    const companyIds: Record<number, number> = { 30: 100, 31: 101 }
    return { companyId: companyIds[where.id] ?? null }
  }) },
  evaluation: { findMany: vi.fn(async () => [{ id: 7, placementId: 1, kind: 'COMPANY' }]) },
}

describe('HTTP read authorization for schedules and evaluations', () => {
  let app: INestApplication
  let baseUrl: string
  let principal = { sub: 10, role: Role.STUDENT as Role }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PlacementController, EvaluationController],
      providers: [
        PlacementService, EvaluationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AccreditationService, useValue: {} },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({
      // Authenticate a controlled principal; keep the real roles guard and HTTP routing.
      canActivate(context: ExecutionContext) {
        context.switchToHttp().getRequest().user = principal
        return true
      },
    }).compile()
    app = module.createNestApplication()
    await app.listen(0, '127.0.0.1')
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`
  })
  afterAll(async () => { await app?.close() })
  beforeEach(() => { vi.clearAllMocks() })

  const actors = [
    { name: 'assigned student', id: 10, role: Role.STUDENT, status: 200 },
    { name: 'assigned tutor', id: 20, role: Role.TUTOR, status: 200 },
    { name: 'own company', id: 30, role: Role.COMPANY, status: 200 },
    { name: 'coordinator', id: 99, role: Role.COORDINATOR, status: 200 },
    { name: 'other student', id: 11, role: Role.STUDENT, status: 403 },
    { name: 'other tutor', id: 21, role: Role.TUTOR, status: 403 },
    { name: 'other company', id: 31, role: Role.COMPANY, status: 403 },
    { name: 'company account without company', id: 32, role: Role.COMPANY, status: 403 },
    { name: 'missing company account', id: 33, role: Role.COMPANY, status: 403 },
    { name: 'student role with tutor ID', id: 20, role: Role.STUDENT, status: 403 },
  ]

  describe.each(['schedule', 'evaluations'])('%s', (endpoint) => {
    it.each(actors)('$name receives $status', async (actor) => {
      principal = { sub: actor.id, role: actor.role }
      const response = await fetch(`${baseUrl}/placements/1/${endpoint}`)
      expect(response.status).toBe(actor.status)
      if (actor.status === 403) {
        expect(prisma.evaluation.findMany).not.toHaveBeenCalled()
      } else if (endpoint === 'evaluations') {
        expect(await response.json()).toEqual([{ id: 7, placementId: 1, kind: 'COMPANY' }])
        expect(prisma.evaluation.findMany).toHaveBeenCalledWith({
          where: { placementId: 1, deletedAt: null }, orderBy: { submittedAt: 'desc' },
        })
      } else {
        expect(await response.json()).toMatchObject({ requiredHours: 4, totalSessions: 1 })
      }
    })

    it('returns 404 for a missing placement', async () => {
      principal = { sub: 99, role: Role.COORDINATOR }
      const response = await fetch(`${baseUrl}/placements/999/${endpoint}`)
      expect(response.status).toBe(404)
      expect(prisma.evaluation.findMany).not.toHaveBeenCalled()
    })
  })
})
