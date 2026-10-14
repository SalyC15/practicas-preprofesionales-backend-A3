import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { ApplicationStatus, PlacementStatus, Role } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module'
import { HttpExceptionFilter } from '../common/http-exception.filter'
import { InstitutionTimezoneConfig } from '../common/institution-timezone.config'
import { PrismaService } from '../prisma/prisma.service'

type LoggedHour = { id: number; date: Date; version: number; status: string; activity: string }
type HttpErrorBody = { statusCode: number; message: string | string[] }

const INSTITUTION_TIMEZONE = 'America/Guayaquil'

describe('E6-02 calendar dates through public REST and sync endpoints', () => {
  let app: INestApplication
  let prisma: PrismaService
  let baseUrl: string
  let studentToken: string
  let otherStudentToken: string
  let tutorToken: string
  let studentId: number
  let otherStudentId: number
  let tutorId: number
  let companyId: number
  let activePlacementId: number
  let inactivePlacementId: number
  let legacyReviewLogId: number
  let legacySyncLogId: number
  let institutionNow = new Date('2026-10-15T12:00:00.000Z')

  const userIds: number[] = []
  const sessionIds: string[] = []
  const companyIds: number[] = []
  const offerIds: number[] = []
  const applicationIds: number[] = []
  const placementIds: number[] = []
  const syncClientOpIds: string[] = []

  async function postJson(path: string, body: unknown, token?: string): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    return fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  }

  async function snapshotHourLogs(): Promise<LoggedHour[]> {
    return prisma.hourLog.findMany({
      where: { placementId: activePlacementId },
      orderBy: { id: 'asc' },
      select: { id: true, date: true, version: true, status: true, activity: true },
    })
  }

  async function placementVersion(): Promise<number> {
    const placement = await prisma.placement.findUnique({ where: { id: activePlacementId }, select: { version: true } })
    if (!placement) throw new Error('fixture placement missing')
    return placement.version
  }

  async function expectUnchangedAfterRejection(before: LoggedHour[], versionBefore: number): Promise<void> {
    expect(await snapshotHourLogs()).toEqual(before)
    expect(await placementVersion()).toBe(versionBefore)
  }

  async function createHourLog(
    date: string,
    token = studentToken,
    placementId = activePlacementId,
    activity: string = randomUUID(),
  ) {
    return postJson(
      '/hour-logs',
      { placementId, date, startTime: '08:00', endTime: '12:00', hours: 4, activity },
      token,
    )
  }

  async function createAccessToken(user: { id: number; email: string; role: Role }): Promise<string> {
    const sessionId = randomUUID()
    sessionIds.push(sessionId)
    await prisma.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        generation: 1,
        refreshTokenHash: randomUUID().replaceAll('-', ''),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    return app.get(JwtService).signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      generation: 1,
    })
  }

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', `e602-http-test-${randomUUID()}`)
    vi.stubEnv('AUTH_ACCESS_TOKEN_TTL_SEC', '900')
    vi.stubEnv('AUTH_REFRESH_TOKEN_TTL_SEC', '604800')
    vi.stubEnv('INSTITUTION_TIMEZONE', INSTITUTION_TIMEZONE)

    prisma = new PrismaService()
    await prisma.onModuleInit()

    const timezoneConfig = new InstitutionTimezoneConfig(INSTITUTION_TIMEZONE, () => new Date(institutionNow))
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(InstitutionTimezoneConfig)
      .useValue(timezoneConfig)
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.init()
    await app.listen(0)
    const address = app.getHttpServer().address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}/api`

    const suffix = randomUUID()
    const fixturePassword = `fixture-${randomUUID()}`
    const company = await prisma.company.create({
      data: {
        taxId: `E602-${suffix}`,
        name: `Empresa E6-02 ${suffix}`,
        sector: 'Tecnología',
        contactEmail: `company-${suffix}@example.test`,
      },
    })
    companyId = company.id
    companyIds.push(company.id)

    const student = await prisma.user.create({
      data: {
        email: `student-${suffix}@example.test`,
        password: fixturePassword,
        fullName: `Estudiante E6-02 ${suffix}`,
        role: Role.STUDENT,
      },
    })
    studentId = student.id
    userIds.push(student.id)

    const otherStudent = await prisma.user.create({
      data: {
        email: `other-student-${suffix}@example.test`,
        password: fixturePassword,
        fullName: `Otro estudiante E6-02 ${suffix}`,
        role: Role.STUDENT,
      },
    })
    otherStudentId = otherStudent.id
    userIds.push(otherStudent.id)

    const tutor = await prisma.user.create({
      data: {
        email: `tutor-${suffix}@example.test`,
        password: fixturePassword,
        fullName: `Tutor E6-02 ${suffix}`,
        role: Role.TUTOR,
      },
    })
    tutorId = tutor.id
    userIds.push(tutor.id)

    const offer = await prisma.offer.create({
      data: {
        companyId,
        title: `Práctica E6-02 ${suffix}`,
        description: 'Fixture de integración para fechas calendario',
        modality: 'PRESENCIAL',
        seats: 2,
        requiredHours: 240,
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-10-31T00:00:00.000Z'),
      },
    })
    offerIds.push(offer.id)

    const activeApplication = await prisma.application.create({
      data: {
        offerId: offer.id,
        studentId,
        motivation: 'Fixture activo de integración',
        status: ApplicationStatus.ACCEPTED,
      },
    })
    applicationIds.push(activeApplication.id)
    const activePlacement = await prisma.placement.create({
      data: {
        applicationId: activeApplication.id,
        studentId,
        tutorId,
        companyId,
        startDate: new Date('2026-10-13T23:45:00.000Z'),
        endDate: new Date('2026-10-14T18:15:00.000Z'),
        requiredHours: 240,
        status: PlacementStatus.ACTIVE,
        version: 7,
      },
    })
    activePlacementId = activePlacement.id
    placementIds.push(activePlacement.id)

    const inactiveApplication = await prisma.application.create({
      data: {
        offerId: offer.id,
        studentId: otherStudentId,
        motivation: 'Fixture inactivo de integración',
        status: ApplicationStatus.ACCEPTED,
      },
    })
    applicationIds.push(inactiveApplication.id)
    const inactivePlacement = await prisma.placement.create({
      data: {
        applicationId: inactiveApplication.id,
        studentId: otherStudentId,
        tutorId,
        companyId,
        startDate: new Date('2026-10-13T23:45:00.000Z'),
        endDate: new Date('2026-10-14T18:15:00.000Z'),
        requiredHours: 240,
        status: PlacementStatus.PENDING_DOCS,
      },
    })
    inactivePlacementId = inactivePlacement.id
    placementIds.push(inactivePlacement.id)

    const legacyReviewLog = await prisma.hourLog.create({
      data: {
        placementId: activePlacementId,
        date: new Date('2026-10-13T17:45:00.000Z'),
        startTime: '08:00',
        endTime: '12:00',
        hours: 4,
        activity: 'legacy-review',
        status: 'SUBMITTED',
        version: 4,
        updatedAt: new Date('2026-10-14T10:00:00.000Z'),
      },
    })
    legacyReviewLogId = legacyReviewLog.id

    const legacySyncLog = await prisma.hourLog.create({
      data: {
        placementId: activePlacementId,
        date: new Date('2026-10-13T19:30:00.000Z'),
        startTime: '13:00',
        endTime: '17:00',
        hours: 4,
        activity: 'legacy-sync',
        status: 'SUBMITTED',
        version: 8,
        updatedAt: new Date('2026-10-14T11:00:00.000Z'),
      },
    })
    legacySyncLogId = legacySyncLog.id

    studentToken = await createAccessToken(student)
    otherStudentToken = await createAccessToken(otherStudent)
    tutorToken = await createAccessToken(tutor)
  })

  afterAll(async () => {
    if (app) await app.close()
    if (prisma) {
      await prisma.hourLog.deleteMany({ where: { placementId: { in: placementIds } } })
      await prisma.syncOperation.deleteMany({ where: { clientOpId: { in: syncClientOpIds } } })
      await prisma.placement.deleteMany({ where: { id: { in: placementIds } } })
      await prisma.application.deleteMany({ where: { id: { in: applicationIds } } })
      await prisma.offer.deleteMany({ where: { id: { in: offerIds } } })
      await prisma.authSession.deleteMany({ where: { id: { in: sessionIds } } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } })
      await prisma.$disconnect()
    }
    vi.unstubAllEnvs()
  })

  it('normalizes pure dates and device offsets through REST ValidationPipe into persisted UTC-midnight rows', async () => {
    const cases = [
      ['2026-10-13', '2026-10-13T00:00:00.000Z'],
      ['2026-10-13T23:30:00-05:00', '2026-10-13T00:00:00.000Z'],
      ['2026-10-14T04:30:00.000Z', '2026-10-13T00:00:00.000Z'],
      ['2026-10-14T06:30:00+02:00', '2026-10-13T00:00:00.000Z'],
      ['2026-10-13T21:30:00+09:00', '2026-10-13T00:00:00.000Z'],
      ['2026-10-14', '2026-10-14T00:00:00.000Z'],
    ] as const

    for (const [date, expectedUtc] of cases) {
      const activity = `rest-${randomUUID()}`
      const response = await createHourLog(date, studentToken, activePlacementId, activity)
      expect(response.status).toBe(201)
      const body = (await response.json()) as { id: number; date: string }
      expect(body.date).toBe(expectedUtc)
      const saved = await prisma.hourLog.findUnique({ where: { id: body.id }, select: { date: true } })
      expect(saved?.date.toISOString()).toBe(expectedUtc)
    }
  })

  it('returns exact REST validation errors for impossible, out-of-range and future dates without changing rows or versions', async () => {
    const cases = [
      ['2026-02-30', 'fecha inválida: "2026-02-30" no es un día calendario real'],
      [
        '2026-10-12',
        'La fecha del registro (2026-10-12) está fuera del rango válido de la práctica (2026-10-13 a 2026-10-14).',
      ],
      [
        '2026-10-15',
        'La fecha del registro (2026-10-15) está fuera del rango válido de la práctica (2026-10-13 a 2026-10-14).',
      ],
    ] as const

    for (const [date, expectedMessage] of cases) {
      const before = await snapshotHourLogs()
      const versionBefore = await placementVersion()
      const response = await createHourLog(date)
      expect(response.status).toBe(400)
      const body = (await response.json()) as HttpErrorBody
      expect(body.statusCode).toBe(400)
      expect(body.message).toBe(expectedMessage)
      await expectUnchangedAfterRejection(before, versionBefore)
    }
  })

  it('uses the injected institutional today at the UTC boundary and retains authorization/ownership/status guards', async () => {
    const noToken = await createHourLog('2026-10-13', '')
    expect(noToken.status).toBe(401)
    expect(((await noToken.json()) as HttpErrorBody).message).toBe('falta el token')

    const wrongOwner = await createHourLog('2026-10-13', otherStudentToken)
    expect(wrongOwner.status).toBe(400)
    expect(((await wrongOwner.json()) as HttpErrorBody).message).toBe('el placement no es tuyo')

    const inactive = await createHourLog('2026-10-13', otherStudentToken, inactivePlacementId)
    expect(inactive.status).toBe(400)
    expect(((await inactive.json()) as HttpErrorBody).message).toBe('el placement no está activo')

    const wrongRole = await createHourLog('2026-10-13', tutorToken)
    expect(wrongRole.status).toBe(403)

    institutionNow = new Date('2026-10-14T01:00:00.000Z')
    const before = await snapshotHourLogs()
    const versionBefore = await placementVersion()
    const tomorrow = await createHourLog('2026-10-14')
    expect(tomorrow.status).toBe(400)
    expect(((await tomorrow.json()) as HttpErrorBody).message).toBe('No se pueden registrar horas con fecha futura')
    await expectUnchangedAfterRejection(before, versionBefore)

    const today = await createHourLog('2026-10-13')
    expect(today.status).toBe(201)
    const todayBody = (await today.json()) as { date: string }
    expect(todayBody.date).toBe('2026-10-13T00:00:00.000Z')
    institutionNow = new Date('2026-10-15T12:00:00.000Z')
  })

  it('reads legacy UTC date components unchanged and keeps them through review/status updates', async () => {
    const legacyBefore = await prisma.hourLog.findUnique({ where: { id: legacyReviewLogId } })
    if (!legacyBefore) throw new Error('legacy review fixture missing')

    const listResponse = await fetch(`${baseUrl}/placements/${activePlacementId}/hour-logs`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    })
    expect(listResponse.status).toBe(200)
    const listed = (await listResponse.json()) as Array<{ id: number; date: string }>
    expect(listed.find((row) => row.id === legacyReviewLogId)?.date).toBe('2026-10-13T17:45:00.000Z')

    const forbiddenReview = await fetch(`${baseUrl}/hour-logs/${legacyReviewLogId}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({ status: 'APPROVED' }),
    })
    expect(forbiddenReview.status).toBe(403)

    const reviewResponse = await fetch(`${baseUrl}/hour-logs/${legacyReviewLogId}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tutorToken}` },
      body: JSON.stringify({ status: 'APPROVED', note: 'revisión de integración' }),
    })
    expect(reviewResponse.status).toBe(200)
    const reviewed = await prisma.hourLog.findUnique({ where: { id: legacyReviewLogId } })
    expect(reviewed?.date.toISOString()).toBe('2026-10-13T17:45:00.000Z')
    expect(reviewed?.version).toBe(legacyBefore.version + 1)
    expect(reviewed?.status).toBe('APPROVED')

    const repeatedReview = await fetch(`${baseUrl}/hour-logs/${legacyReviewLogId}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tutorToken}` },
      body: JSON.stringify({ status: 'APPROVED' }),
    })
    expect(repeatedReview.status).toBe(400)
    expect(((await repeatedReview.json()) as HttpErrorBody).message).toBe('solo se revisan registros en SUBMITTED')
    const afterRepeatedReview = await prisma.hourLog.findUnique({ where: { id: legacyReviewLogId } })
    expect(afterRepeatedReview?.date.toISOString()).toBe('2026-10-13T17:45:00.000Z')
    expect(afterRepeatedReview?.version).toBe(legacyBefore.version + 1)
  })

  it('rejects and idempotently replays sync updates without changing stored row/version, then accepts inclusive boundaries', async () => {
    const legacyBefore = await prisma.hourLog.findUnique({ where: { id: legacySyncLogId } })
    if (!legacyBefore) throw new Error('legacy sync fixture missing')
    const before = await snapshotHourLogs()
    const versionBefore = await placementVersion()
    const clientOpId = randomUUID()
    syncClientOpIds.push(clientOpId)
    const rejectedOp = {
      clientOpId,
      entity: 'hourLog',
      op: 'update',
      baseVersion: legacyBefore.version,
      payload: {
        id: legacySyncLogId,
        date: '2026-10-12',
        updatedAt: '2026-10-15T13:00:00.000Z',
      },
    }

    const firstPush = await postJson('/sync/push', { ops: [rejectedOp] }, studentToken)
    expect(firstPush.status).toBe(201)
    const firstBody = (await firstPush.json()) as { results: Array<{ status: string; reason: string }> }
    expect(firstBody.results[0].status).toBe('rejected')
    expect(firstBody.results[0].reason).toBe(
      'La fecha del registro (2026-10-12) está fuera del rango válido de la práctica (2026-10-13 a 2026-10-14).',
    )
    await expectUnchangedAfterRejection(before, versionBefore)

    const persistedOperation = await prisma.syncOperation.findUnique({ where: { clientOpId } })
    expect(persistedOperation).not.toBeNull()
    const secondPush = await postJson('/sync/push', { ops: [rejectedOp] }, studentToken)
    expect(secondPush.status).toBe(201)
    expect(await secondPush.json()).toEqual({ results: firstBody.results })
    const afterReplay = await prisma.hourLog.findUnique({ where: { id: legacySyncLogId } })
    expect(afterReplay?.date.toISOString()).toBe(legacyBefore.date.toISOString())
    expect(afterReplay?.version).toBe(legacyBefore.version)
    expect(await placementVersion()).toBe(versionBefore)

    const sparseUpdateId = randomUUID()
    syncClientOpIds.push(sparseUpdateId)
    const sparseUpdate = await postJson(
      '/sync/push',
      {
        ops: [
          {
            clientOpId: sparseUpdateId,
            entity: 'hourLog',
            op: 'update',
            baseVersion: legacyBefore.version,
            payload: { id: legacySyncLogId, updatedAt: '2026-10-15T14:00:00.000Z' },
          },
        ],
      },
      studentToken,
    )
    expect(sparseUpdate.status).toBe(201)
    expect(((await sparseUpdate.json()) as { results: Array<{ status: string }> }).results[0].status).toBe('applied')
    const afterSparseUpdate = await prisma.hourLog.findUnique({ where: { id: legacySyncLogId } })
    expect(afterSparseUpdate?.date.toISOString()).toBe(legacyBefore.date.toISOString())
    expect(afterSparseUpdate?.version).toBe(legacyBefore.version + 1)

    const boundaryOps = ['2026-10-13', '2026-10-14'].map((date) => {
      const opId = randomUUID()
      syncClientOpIds.push(opId)
      return {
        clientOpId: opId,
        entity: 'hourLog',
        op: 'create',
        baseVersion: null,
        payload: {
          placementId: activePlacementId,
          date,
          startTime: '08:00',
          endTime: '12:00',
          hours: 4,
          activity: `sync-boundary-${date}-${opId}`,
        },
      }
    })
    const boundariesResponse = await postJson('/sync/push', { ops: boundaryOps }, studentToken)
    expect(boundariesResponse.status).toBe(201)
    const boundaryBody = (await boundariesResponse.json()) as {
      results: Array<{ status: string; server: { id: number; date: string } }>
    }
    expect(boundaryBody.results.map((result) => result.status)).toEqual(['applied', 'applied'])
    expect(boundaryBody.results.map((result) => result.server.date)).toEqual([
      '2026-10-13T00:00:00.000Z',
      '2026-10-14T00:00:00.000Z',
    ])
    for (const result of boundaryBody.results) {
      const saved = await prisma.hourLog.findUnique({ where: { id: result.server.id }, select: { date: true } })
      expect(saved?.date.toISOString()).toBe(result.server.date)
    }

    const wrongOwnerOpId = randomUUID()
    syncClientOpIds.push(wrongOwnerOpId)
    const wrongOwnerPush = await postJson(
      '/sync/push',
      {
        ops: [
          {
            clientOpId: wrongOwnerOpId,
            entity: 'hourLog',
            op: 'create',
            baseVersion: null,
            payload: {
              placementId: activePlacementId,
              date: '2026-10-13',
              startTime: '08:00',
              endTime: '12:00',
              hours: 4,
              activity: `wrong-owner-${wrongOwnerOpId}`,
            },
          },
        ],
      },
      otherStudentToken,
    )
    expect(
      ((await wrongOwnerPush.json()) as { results: Array<{ status: string; reason: string }> }).results[0],
    ).toMatchObject({ status: 'rejected', reason: 'el placement no pertenece al usuario' })
  })
})
