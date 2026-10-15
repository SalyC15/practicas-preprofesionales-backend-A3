import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { describe, expect, it } from 'vitest'

type PlanNode = { 'Node Type': string; 'Index Name'?: string; Plans?: PlanNode[] }
type Explain = { 'QUERY PLAN': { Plan: PlanNode }[] }[]
type Row = { id: number; placementId: number; date: Date; deletedAt: Date | null }
const indexName = 'hour_logs_placementId_deletedAt_date_idx'
const migration = readFileSync(resolve('prisma/migrations/20261014220000_hour_logs_placement_date_index/migration.sql'), 'utf8')
const nodes = (plan: PlanNode): PlanNode[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)]

describe('E2-04: índice del libro de horas', () => {
  it('aplica la migración, cambia Seq Scan por el índice y conserva filas y orden', async () => {
    const prisma = new PrismaClient()
    try {
      await prisma.$transaction(async (tx) => {
        // The temporary table shadows hour_logs only in this connection. No public data or index is changed.
        await tx.$executeRaw`CREATE TEMP TABLE hour_logs (LIKE public.hour_logs INCLUDING DEFAULTS) ON COMMIT DROP`
        await tx.$executeRaw`
          INSERT INTO hour_logs (id, "placementId", date, "startTime", "endTime", hours, activity, "updatedAt", "deletedAt")
          SELECT i, ((i - 1) % 1000) + 1,
            timestamp '2026-01-01' + ((i - 1) / 1000) * interval '1 day',
            '08:00', '12:00', 4, 'E2-04 fixture', now(),
            CASE WHEN ((i - 1) / 1000) % 5 = 0 THEN now() ELSE NULL END
          FROM generate_series(1, 20000) AS i
        `
        await tx.$executeRaw`ANALYZE hour_logs`
        const explain = () => tx.$queryRaw<Explain>`
          EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          SELECT * FROM hour_logs WHERE "placementId" = ${42} AND "deletedAt" IS NULL ORDER BY date DESC
        `
        const query = () => tx.$queryRaw<Row[]>`
          SELECT * FROM hour_logs WHERE "placementId" = ${42} AND "deletedAt" IS NULL ORDER BY date DESC
        `
        const before = await query()
        const beforePlan = (await explain())[0]['QUERY PLAN'][0].Plan
        expect(nodes(beforePlan).some(node => node['Node Type'] === 'Seq Scan')).toBe(true)

        // Execute exactly the checked-in migration against the isolated table.
        await tx.$executeRawUnsafe(migration)
        const afterPlan = (await explain())[0]['QUERY PLAN'][0].Plan
        expect(nodes(afterPlan).some(node => node['Index Name'] === indexName)).toBe(true)
        expect(nodes(afterPlan).some(node => node['Node Type'] === 'Seq Scan')).toBe(false)
        const after = await query()
        expect(after).toEqual(before)
        expect(after).toHaveLength(16)
        expect(after.every(row => row.placementId === 42 && row.deletedAt === null)).toBe(true)
        expect(after.every((row, i) => i === 0 || after[i - 1].date >= row.date)).toBe(true)
      }, { timeout: 30000 })
    } finally {
      await prisma.$disconnect()
    }
  }, 30000)
})
