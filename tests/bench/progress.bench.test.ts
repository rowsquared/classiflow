import { writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/lib/api-auth'

// Progress and queue timings on the seeded "bench" workspace
// (scripts/bench/seed-progress.ts). Prints a Markdown table: p50/p95 over
// BENCH_ITERATIONS runs (after two warm-up runs), SQL statements per call and
// response size. Each call runs in its own workspace transaction as the
// runtime role, as a route handler would. BENCH_LEGACY may name a module with
// the old getProgressStats/getProgressTimeline/getTeamProgress to compare.
//
//   TEST_DATABASE_URL=postgresql://.../classiflow_bench_test npm run bench:progress
//
// BENCH_OUT=<file> writes the table to a file instead of the console;
// BENCH_FILTER=<text> runs only the calls whose name contains it.

const queries = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/lib/prisma', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/prisma')>()
  const { PrismaClient } = await import('@/lib/generated/prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 5 }),
    log: [{ emit: 'event', level: 'query' }]
  })
  client.$on('query', () => {
    queries.count++
  })
  return { ...original, prisma: client }
})

import { withWorkspace } from '@/lib/workspace/db'
import * as progress from '@/lib/server/progress'
import { getQueueStats, listQueue } from '@/lib/server/sentences'

const WORKSPACE = 'bench'
const ITERATIONS = Number(process.env.BENCH_ITERATIONS) || 15

const viewer = (id: string, role: CurrentUser['role'], membershipId: string): CurrentUser => ({
  id,
  role,
  workspaceId: WORKSPACE,
  membershipId,
  authority: 'membership',
  archived: false
})
const viewers = {
  admin: viewer('u_admin', 'admin', 'm_admin'),
  supervisor: viewer('u_sup0', 'supervisor', 'm_sup0'),
  labeller: viewer('u_lab1', 'labeller', 'm_lab1')
}

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)
const short = { startDate: day(6), endDate: day(0) }
const long = { startDate: day(729), endDate: day(0) }
const asRange = (r: { startDate: string; endDate: string }) => ({
  start: new Date(`${r.startDate}T00:00:00Z`),
  end: new Date(`${r.endDate}T23:59:59.999Z`)
})

type Case = { name: string; roles: Array<keyof typeof viewers>; run: (user: CurrentUser) => Promise<unknown> }

const people = (range: typeof short, sort: 'name' | 'labeled' = 'name') => ({
  ...range,
  q: undefined,
  sort,
  dir: 'desc' as const,
  page: 1,
  pageSize: 25
})

const current: Case[] = [
  {
    name: 'overview, 7 days',
    roles: ['admin', 'supervisor', 'labeller'],
    run: u => progress.getProgressOverview(u, short)
  },
  { name: 'overview, 2 years', roles: ['admin', 'supervisor'], run: u => progress.getProgressOverview(u, long) },
  {
    name: 'overview, person, 2 years',
    roles: ['admin'],
    run: u => progress.getProgressOverview(u, { ...long, personId: 'u_lab2' })
  },
  {
    name: 'activity daily, 7 days',
    roles: ['admin', 'supervisor', 'labeller'],
    run: u => progress.getProgressActivity(u, { ...short, granularity: 'day' })
  },
  {
    name: 'activity weekly, 2 years',
    roles: ['admin', 'supervisor'],
    run: u => progress.getProgressActivity(u, { ...long, granularity: 'week' })
  },
  { name: 'people, 7 days', roles: ['admin', 'supervisor'], run: u => progress.getProgressPeople(u, people(short)) },
  {
    name: 'people by labeled, 2 years',
    roles: ['admin', 'supervisor'],
    run: u => progress.getProgressPeople(u, people(long, 'labeled'))
  },
  {
    name: 'team (grouped), 7 days',
    roles: ['admin', 'supervisor'],
    run: u => progress.getTeamProgress(u, asRange(short))
  },
  { name: 'team (grouped), 2 years', roles: ['admin'], run: u => progress.getTeamProgress(u, asRange(long)) },
  {
    name: 'queue list, q=engineer',
    roles: ['admin'],
    run: u => listQueue(u, new URLSearchParams('q=engineer&page=1&limit=50'))
  },
  {
    name: 'queue stats, q=engineer',
    roles: ['admin'],
    run: u => getQueueStats(u, new URLSearchParams('q=engineer'))
  },
  {
    name: 'queue list, q=a1b2',
    roles: ['admin'],
    run: u => listQueue(u, new URLSearchParams('q=a1b2&page=1&limit=50'))
  }
]

type Legacy = {
  getProgressStats: (u: CurrentUser, r: { start: Date; end: Date }) => Promise<unknown>
  getProgressTimeline: (u: CurrentUser, r: { start: Date; end: Date }, g: 'day' | 'week') => Promise<unknown>
  getTeamProgress: (u: CurrentUser, r: { start: Date; end: Date }) => Promise<unknown>
}

function legacyCases(legacy: Legacy): Case[] {
  return [
    {
      name: 'old stats, 7 days',
      roles: ['admin', 'supervisor', 'labeller'],
      run: u => legacy.getProgressStats(u, asRange(short))
    },
    { name: 'old stats, 2 years', roles: ['admin'], run: u => legacy.getProgressStats(u, asRange(long)) },
    {
      name: 'old timeline daily, 7 days',
      roles: ['admin', 'supervisor'],
      run: u => legacy.getProgressTimeline(u, asRange(short), 'day')
    },
    {
      name: 'old timeline weekly, 2 years',
      roles: ['admin'],
      run: u => legacy.getProgressTimeline(u, asRange(long), 'week')
    },
    { name: 'old team, 7 days', roles: ['admin', 'supervisor'], run: u => legacy.getTeamProgress(u, asRange(short)) },
    { name: 'old team, 2 years', roles: ['admin'], run: u => legacy.getTeamProgress(u, asRange(long)) }
  ]
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!

async function measure(run: () => Promise<unknown>) {
  const times: number[] = []
  let statements = 0
  let bytes = 0
  for (let i = 0; i < ITERATIONS + 2; i++) {
    queries.count = 0
    const started = performance.now()
    const result = await withWorkspace(WORKSPACE, run)
    const elapsed = performance.now() - started
    if (i < 2) continue
    times.push(elapsed)
    statements = queries.count
    bytes = Buffer.byteLength(JSON.stringify(result))
  }
  times.sort((a, b) => a - b)
  return { p50: percentile(times, 0.5), p95: percentile(times, 0.95), statements, bytes }
}

describe('progress benchmark', () => {
  it('the grouped team query gives the old per-member figures', async () => {
    const legacyModule = process.env.BENCH_LEGACY
    if (!legacyModule) return
    const legacy = (await import(/* @vite-ignore */ legacyModule)) as Legacy
    const byId = (result: unknown) =>
      [...(result as { team: Array<{ id: string }> }).team].sort((a, b) => a.id.localeCompare(b.id))
    for (const user of [viewers.admin, viewers.supervisor]) {
      for (const range of [short, long]) {
        const [before, after] = await Promise.all([
          withWorkspace(WORKSPACE, () => legacy.getTeamProgress(user, asRange(range))),
          withWorkspace(WORKSPACE, () => progress.getTeamProgress(user, asRange(range)))
        ])
        expect(byId(after)).toEqual(byId(before))
      }
    }
  })

  it('measures the reports', async () => {
    const legacyModule = process.env.BENCH_LEGACY
    const legacy = legacyModule ? ((await import(/* @vite-ignore */ legacyModule)) as Legacy) : null
    const only = process.env.BENCH_FILTER
    const cases = [...(legacy ? legacyCases(legacy) : []), ...current].filter(c => !only || c.name.includes(only))
    const lines = [
      `${ITERATIONS} runs per row after 2 warm-ups; statements include BEGIN, set_config and COMMIT.`,
      '',
      '| Call | Viewer | p50 ms | p95 ms | SQL statements | Response bytes |',
      '| --- | --- | ---: | ---: | ---: | ---: |'
    ]
    for (const c of cases) {
      for (const role of c.roles) {
        const m = await measure(() => c.run(viewers[role]))
        lines.push(
          `| ${c.name} | ${role} | ${m.p50.toFixed(0)} | ${m.p95.toFixed(0)} | ${m.statements} | ${m.bytes.toLocaleString('en')} |`
        )
      }
    }
    const table = lines.join('\n')
    if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, `${table}\n`)
    else process.stdout.write(`${table}\n`)
    expect(lines.length).toBeGreaterThan(4)
  })
})
