import { randomUUID } from 'node:crypto'
import { type ExecutionContext, type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CompanyController } from '../company/company.controller'
import { CompanyService } from '../company/company.service'
import { OfferController } from '../offer/offer.controller'
import { OfferService } from '../offer/offer.service'
import { PrismaService } from '../prisma/prisma.service'

describe('server pagination with 10000 records', () => {
  const prefix = `qa-page-${randomUUID()}`
  const prisma = new PrismaService()
  let app: INestApplication
  let base: string
  let companyId: number

  beforeAll(async () => {
    await prisma.$connect()
    for (let batch = 0; batch < 10; batch++) {
      await prisma.company.createMany({ data: Array.from({ length: 1000 }, (_, offset) => ({
        name: `${prefix}-${batch * 1000 + offset}`, taxId: `${prefix}-${batch * 1000 + offset}`,
        sector: 'QA', contactEmail: 'qa@example.test',
      })) })
    }
    const company = await prisma.company.findFirstOrThrow({ where: { taxId: `${prefix}-0` } })
    companyId = company.id
    for (let batch = 0; batch < 10; batch++) {
      await prisma.offer.createMany({ data: Array.from({ length: 1000 }, (_, offset) => ({
        companyId, title: `${prefix}-${batch * 1000 + offset}`, description: 'Fixture de paginación',
        modality: offset % 2 === 0 ? 'PRESENCIAL' : 'HIBRIDA', seats: 2, requiredHours: 240,
        periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31'),
        status: 'PUBLISHED', publishedAt: new Date('2026-10-22'),
      })) })
    }
    const module = await Test.createTestingModule({
      controllers: [CompanyController, OfferController], providers: [CompanyService, OfferService, { provide: PrismaService, useValue: prisma }],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate(context: ExecutionContext) {
      context.switchToHttp().getRequest().user = { sub: 1, role: 'COORDINATOR' }
      return true
    } }).compile()
    app = module.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${app.getHttpServer().address().port}`
  }, 60000)

  afterAll(async () => {
    await app?.close()
    if (companyId) await prisma.offer.deleteMany({ where: { companyId } })
    await prisma.company.deleteMany({ where: { taxId: { startsWith: prefix } } })
    await prisma.$disconnect()
  }, 30000)

  describe.each(['companies', 'offers'])('%s', (entity) => {
    async function page(number: number) {
      const response = await fetch(`${base}/${entity}/paged?page=${number}&pageSize=25&search=${prefix}`)
      expect(response.status).toBe(200)
      return response.json() as Promise<{ total: number; items: { id: number; modality: string }[] }>
    }
    it('bounds responses, keeps a stable order and reaches the final page', async () => {
      const first = await page(1)
      const second = await page(2)
      const last = await page(400)
      expect(first).toMatchObject({ total: 10000, pageSize: 25, totalPages: 400 })
      expect(first.items).toHaveLength(25)
      expect(second.items).toHaveLength(25)
      expect(last.items).toHaveLength(25)
      expect(new Set([...first.items, ...second.items].map((item: { id: number }) => item.id)).size).toBe(50)
      expect((await page(1)).items.map((item: { id: number }) => item.id)).toEqual(first.items.map((item: { id: number }) => item.id))
      expect((await page(401)).items).toEqual([])
    })
    it.each(['page=0', 'page=-1', 'page=1.5', 'pageSize=101', 'pageSize=0', 'page=no'])('rejects invalid bounds: %s', async (query) => {
      const response = await fetch(`${base}/${entity}/paged?${query}`)
      expect(response.status).toBe(400)
    })
  })
  it('filters on the server before counting and paging', async () => {
    const response = await fetch(`${base}/offers/paged?search=${prefix}&modality=HIBRIDA&pageSize=10`)
    const data = await response.json() as { total: number; items: { modality: string }[] }
    expect(data.total).toBe(5000)
    expect(data.items).toHaveLength(10)
    expect(data.items.every((item: { modality: string }) => item.modality === 'HIBRIDA')).toBe(true)
  })
})
