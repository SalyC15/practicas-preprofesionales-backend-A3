import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ApplicationService } from '../application/application.service'
import { OfferService } from '../offer/offer.service'
import { AccreditationService } from '../placement/accreditation.service'

describe('remaining server pages', () => {
  const prisma = new PrismaService()
  const prefix = `qa-remaining-${randomUUID()}`
  const offers = new OfferService(prisma)
  const applications = new ApplicationService(prisma, offers)
  const accreditation = new AccreditationService(prisma)
  let companyId: number
  let companyUserId: number
  let tutorId: number
  let offerId: number
  let studentIds: number[] = []
  let placementIds: number[] = []
  const query = { page: 1, pageSize: 10 }

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { taxId: prefix, name: prefix, sector: 'QA', contactEmail: `${prefix}@example.test` } })
    companyId = company.id
    const owner = await prisma.user.create({ data: { email: `${prefix}-owner@example.test`, password: 'fixture', fullName: prefix, role: Role.COMPANY, companyId } })
    companyUserId = owner.id
    const tutor = await prisma.user.create({ data: { email: `${prefix}-tutor@example.test`, password: 'fixture', fullName: prefix, role: Role.TUTOR } })
    tutorId = tutor.id
    await prisma.user.createMany({ data: Array.from({ length: 40 }, (_, i) => ({ email: `${prefix}-${i}@example.test`, password: 'fixture', fullName: `${prefix}-${i}`, role: Role.STUDENT })) })
    studentIds = (await prisma.user.findMany({ where: { email: { startsWith: prefix }, role: Role.STUDENT }, orderBy: { id: 'asc' }, select: { id: true } })).map((u) => u.id)
    const offer = await prisma.offer.create({ data: { companyId, title: prefix, description: prefix, modality: 'PRESENCIAL', seats: 100,
      requiredHours: 4, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-06-30'), status: 'PUBLISHED' } })
    offerId = offer.id
    await prisma.application.createMany({ data: studentIds.map((studentId) => ({ offerId, studentId, motivation: prefix, status: 'ACCEPTED' })) })
    const rows = await prisma.application.findMany({ where: { offerId }, orderBy: { id: 'asc' } })
    await prisma.placement.createMany({ data: rows.map((row) => ({ applicationId: row.id, studentId: row.studentId, tutorId, companyId,
      startDate: new Date('2026-01-01'), endDate: new Date('2026-06-30'), requiredHours: 4, status: 'ACTIVE' })) })
    placementIds = (await prisma.placement.findMany({ where: { companyId }, orderBy: { id: 'asc' }, select: { id: true } })).map((p) => p.id)
    const placementId = placementIds[0]
    await prisma.hourLog.create({ data: { placementId, date: new Date('2026-01-02'), startTime: '08:00', endTime: '12:00', hours: 4, activity: prefix, status: 'APPROVED' } })
    await prisma.document.createMany({ data: (['AGREEMENT', 'INSURANCE', 'REPORT'] as const).map((kind) => ({ placementId, kind, filename: prefix,
      mimeType: 'text/plain', size: 1, storageKey: prefix, status: 'VALIDATED', uploadedById: studentIds[0] })) })
    await prisma.evaluation.createMany({ data: [{ kind: 'TUTOR' as const, evaluatorId: tutorId }, { kind: 'COMPANY' as const, evaluatorId: companyUserId }].map((row) => ({
      ...row, placementId, period: '2026-1', scores: { technical: 4, communication: 4, punctuality: 4 } })) })
    await prisma.offer.createMany({ data: Array.from({ length: 30 }, () => ({ companyId, title: prefix, description: prefix, modality: 'PRESENCIAL', seats: 1,
      requiredHours: 4, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-06-30') })) })
  }, 30000)

  afterAll(async () => {
    if (companyId) {
      await prisma.hourLog.deleteMany({ where: { placementId: { in: placementIds } } })
      await prisma.document.deleteMany({ where: { placementId: { in: placementIds } } })
      await prisma.evaluation.deleteMany({ where: { placementId: { in: placementIds } } })
      await prisma.placement.deleteMany({ where: { companyId } })
      await prisma.application.deleteMany({ where: { offer: { companyId } } })
      await prisma.offer.deleteMany({ where: { companyId } })
      await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } })
      await prisma.company.delete({ where: { id: companyId } })
    }
    await prisma.$disconnect()
  })

  it('keeps global accepted count when paging applicants and rejects other companies', async () => {
    const first = await applications.listPage(query, { offerId }, companyUserId, Role.COMPANY)
    const second = await applications.listPage({ ...query, page: 2 }, { offerId }, companyUserId, Role.COMPANY)
    expect(first).toMatchObject({ total: 40, accepted: 40, totalPages: 4 })
    expect(first.items).toHaveLength(10)
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(20)
    await expect(applications.listPage(query, { offerId }, tutorId, Role.COMPANY)).rejects.toThrow('no tienes acceso')
  })
  it('scopes student pages and single-offer lookup to the student', async () => {
    const mine = await applications.listPage(query, { studentId: studentIds[0] }, studentIds[0], Role.STUDENT)
    expect(mine.total).toBe(1)
    expect(mine.items[0].studentId).toBe(studentIds[0])
    expect(await applications.findMineForOffer(tutorId, offerId)).toBeNull()
  })
  it('counts company offers and applicants without returning applicant arrays', async () => {
    const first = await offers.findMyPage(companyUserId, query)
    const last = await offers.findMyPage(companyUserId, { page: 4, pageSize: 10 })
    expect(first).toMatchObject({ total: 31, summary: { published: 1, drafts: 30, applications: 40 } })
    expect(first.items).toHaveLength(10)
    expect(last.items).toHaveLength(1)
    expect(last.items[0]).toMatchObject({ id: offerId, applicationCount: 40, acceptedCount: 40, applications: [] })
  })
  it('keeps accreditation totals global and calculates from all hours and documents', async () => {
    const result = await accreditation.reportPage({ ...query, period: '2026-1' })
    expect(result.total).toBeGreaterThanOrEqual(40)
    expect(result.items.length).toBeLessThanOrEqual(10)
    expect(result.summary.accredited).toBeGreaterThanOrEqual(1)
    expect(result.summary.pending).toBeGreaterThanOrEqual(39)
    expect(result.summary.accredited + result.summary.pending + result.summary.notAccredited).toBe(result.total)
  })
})
