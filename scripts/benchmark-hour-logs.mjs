/* global console */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
const repoRequire = createRequire(join(process.cwd(), 'package.json'))
repoRequire('dotenv').config({ quiet: true })
const { PrismaClient } = repoRequire('@prisma/client')
const { HourLogService } = repoRequire('./dist/src/hour-log/hour-log.service')
const INDEX_NAME = 'hour_logs_placementId_deletedAt_date_idx'

function nodes(plan) {
  return [plan, ...(plan.Plans ?? []).flatMap(nodes)]
}

// Uses the SQL emitted by the actual service, with bound Prisma parameters.
// No data/schema changes, optimizer switches or forced plans are used.
async function main() {
  const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
  let captured
  prisma.$on('query', event => {
    if (event.query.startsWith('SELECT') && event.query.includes('FROM "public"."hour_logs"')) captured = event
  })
  try {
    const [largest] = await prisma.$queryRaw`
      SELECT "placementId", count(*)::int AS rows FROM hour_logs
      WHERE "deletedAt" IS NULL GROUP BY "placementId"
      ORDER BY count(*) DESC, "placementId" ASC LIMIT 1
    `
    assert.ok(largest, 'Database must contain hour logs; run the seed on a fresh local database')
    const placementFlag = process.argv.indexOf('--placement')
    const placementId = placementFlag >= 0 ? Number(process.argv[placementFlag + 1]) : largest.placementId
    assert.ok(Number.isSafeInteger(placementId) && placementId > 0)
    const service = new HourLogService(prisma)
    const rows = await service.listForPlacement(placementId)
    const { query, params } = captured
    const values = JSON.parse(params)
    const [table] = await prisma.$queryRaw`SELECT count(*)::int AS rows FROM hour_logs`
    const samples = []
    let representative
    for (let i = 0; i < 31; i++) {
      const [result] = await prisma.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query, ...values)
      const plan = result['QUERY PLAN'][0]
      if (i > 0) samples.push(plan['Execution Time'])
      if (i === 15) representative = plan
    }
    const text = await prisma.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS) ' + query, ...values)
    samples.sort((a, b) => a - b)
    const planNodes = nodes(representative.Plan)
    const usesIndex = planNodes.some(node => node['Index Name'] === INDEX_NAME)
    if (process.argv.includes('--verify')) {
      assert.ok(usesIndex, 'Natural PostgreSQL plan must use the migrated index')
    }
    assert.ok(rows.every(row => row.placementId === placementId && row.deletedAt === null))
    assert.ok(rows.every((row, i) => i === 0 || rows[i - 1].date >= row.date))
    console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version,
      prisma: repoRequire('@prisma/client/package.json').version,
      protocol: 'Actual service SQL; EXPLAIN ANALYZE BUFFERS, 1 warmup + 30 sequential samples; normal planner settings',
      placementId, tableRows: table.rows, returnedRows: rows.length, query, params: values,
      medianMs: Number(((samples[14] + samples[15]) / 2).toFixed(4)),
      minMs: samples[0], maxMs: samples[29], samplesMs: samples,
      usesIndex, planNodes: planNodes.map(node => ({ type: node['Node Type'], index: node['Index Name'] })),
      explainText: text.map(row => row['QUERY PLAN']).join('\n'), plan: representative,
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
