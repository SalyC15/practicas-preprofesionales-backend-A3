/* global console, fetch */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import assert from 'node:assert/strict'
const repoRequire = createRequire(join(process.cwd(), 'package.json'))
repoRequire('dotenv').config({ quiet: true })
const { PrismaClient, Role } = repoRequire('@prisma/client')
const { Test } = repoRequire('@nestjs/testing')
const { ValidationPipe } = repoRequire('@nestjs/common')
const bcrypt = repoRequire('bcryptjs')
const { AppModule } = repoRequire('./dist/src/app.module')
const { PrismaService } = repoRequire('./dist/src/prisma/prisma.service')
const { HttpExceptionFilter } = repoRequire('./dist/src/common/http-exception.filter')


async function measureCase(baseUrl, accessToken, role, { size, offerId, expected }, counter) {
  const samples = []
  for (let i = 0; i < 11; i++) {
    counter.value = 0
    const started = performance.now()
    const response = await fetch(`${baseUrl}/api/offers/${offerId}/applications`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const body = await response.json()
    const elapsed = performance.now() - started
    const queries = counter.value
    assert.equal(response.status, 200)
    const byId = rows => [...rows].sort((a, b) => a.id - b.id)
    assert.deepEqual(byId(body), byId(expected), 'all application and public student fields must match')
    if (i > 0) samples.push({ ms: Number(elapsed.toFixed(2)), queries })
  }
  const times = samples.map(sample => sample.ms).sort((a, b) => a - b)
  const counts = [...new Set(samples.map(sample => sample.queries))]
  assert.equal(counts.length, 1, 'query count must be stable across requests')
  return { role, applications: size, queries: counts[0],
    medianMs: Number(((times[4] + times[5]) / 2).toFixed(2)), maxMs: times[9], samples }
}

// Run after npm run build. All measurements use real HTTP, JWT guards and SQL.
// Fixtures have unique IDs and are removed in finally; existing data is untouched.
async function main() {
  const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
  const counter = { value: 0 }
  prisma.$on('query', () => { counter.value++ })
  const suffix = randomUUID()
  const password = randomUUID()
  const hash = await bcrypt.hash(password, 10)
  let fixture
  let app
  try {
    await prisma.$connect()
    fixture = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: {
        taxId: `E203-${suffix}`, name: 'Benchmark E2-03', sector: 'Software',
        contactEmail: `company-${suffix}@example.com`,
      } })
      await tx.user.createMany({ data: [
        { email: `owner-${suffix}@example.com`, password: hash, fullName: 'Owner', role: Role.COMPANY, companyId: company.id },
        { email: `coordinator-${suffix}@example.com`, password: hash, fullName: 'Coordinator', role: Role.COORDINATOR },
        ...Array.from({ length: 200 }, (_, i) => ({
          email: `student-${i}-${suffix}@example.com`, password: hash,
          fullName: `Student ${i}`, role: Role.STUDENT,
        })),
      ] })
      const users = await tx.user.findMany({ where: { email: { endsWith: `${suffix}@example.com` } }, orderBy: { id: 'asc' } })
      const students = users.filter(user => user.role === Role.STUDENT)
      const cases = []
      for (const size of [0, 1, 20, 200]) {
        const offer = await tx.offer.create({ data: {
          companyId: company.id, title: `E2-03: ${size}`, description: 'Temporary fixture',
          modality: 'PRESENCIAL', seats: 200, requiredHours: 240,
          periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31'),
        } })
        if (size > 0) await tx.application.createMany({ data: students.slice(0, size).map((student, i) => ({
          offerId: offer.id, studentId: student.id, motivation: `Motivation ${i}`,
          status: ['SUBMITTED', 'INTERVIEW', 'REJECTED', 'WITHDRAWN'][i % 4],
          decidedAt: i % 4 > 1 ? new Date('2026-01-02') : null,
        })) })
        const expected = await tx.application.findMany({ where: { offerId: offer.id },
          include: { student: { select: { id: true, email: true, fullName: true } } },
        })
        cases.push({ size, offerId: offer.id, expected: JSON.parse(JSON.stringify(expected)) })
      }
      return { companyId: company.id, users, cases }
    }, { timeout: 30000 })

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).compile()
    app = module.createNestApplication({ logger: false })
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(0, '127.0.0.1')
    const baseUrl = await app.getUrl()
    const results = []
    for (const role of [Role.COMPANY, Role.COORDINATOR]) {
      const user = fixture.users.find(user => user.role === role)
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password }),
      })
      assert.equal(login.status, 201, 'login must succeed')
      const { accessToken } = await login.json()
      for (const { size, offerId, expected } of fixture.cases) {
        results.push(await measureCase(baseUrl, accessToken, role, { size, offerId, expected }, counter))
      }
    }
    if (process.argv.includes('--verify')) {
      for (const role of [Role.COMPANY, Role.COORDINATOR]) {
        const nonempty = results.filter(result => result.role === role && result.applications > 0)
        assert.equal(new Set(nonempty.map(result => result.queries)).size, 1, 'SQL must not grow with applications')
        assert.equal(nonempty[0].queries, role === Role.COMPANY ? 5 : 4)
      }
      for (const result of results.filter(result => result.applications === 200)) {
        assert.ok(result.maxMs < 500, `200 applications exceeded 500 ms: ${result.maxMs}`)
      }
    }
    console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version,
      prisma: repoRequire('@prisma/client/package.json').version,
      protocol: 'HTTP loopback, full JWT/session/authorization, 1 warmup + 10 sequential samples per case; login and setup excluded',
      responseContract: 'Exact comparison of all application fields and student {id,email,fullName}', results }, null, 2))
  } finally {
    if (app) await app.close()
    if (fixture) await prisma.$transaction(async (tx) => {
      await tx.application.deleteMany({ where: { offer: { companyId: fixture.companyId } } })
      await tx.offer.deleteMany({ where: { companyId: fixture.companyId } })
      await tx.user.deleteMany({ where: { id: { in: fixture.users.map(user => user.id) } } })
      await tx.company.delete({ where: { id: fixture.companyId } })
    })
    await prisma.$disconnect()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
