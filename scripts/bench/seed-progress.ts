// Seeds a disposable database with a representative workspace for the progress
// and queue benchmarks (docs/plans/progress-dashboard.md, "Performance budget").
//
//   DATABASE_URL=postgresql://.../classiflow_bench_test node scripts/bench/seed-progress.ts --records 50000
//
// Refuses to run unless the database name ends in _bench or _test: it EMPTIES
// EVERY TABLE first. Deterministic: the same --records gives the same data.
// Migrations must already be applied (`npx prisma migrate deploy`).
//
// Shape: one workspace "bench" with an admin, a head supervisor over three
// supervisors, 48 labellers (12 of them suspended), two taxonomies (3 and 2
// levels), records assigned round robin with every fifth record shared by a
// second labeller, 70% labeled in taxonomy A and 40% also in B over 180 days,
// repeated saves, AI suggestions on 30%, a few comments, flags, skipped and
// escalated records. Activity rows mirror the label saves.
import { connect } from '../lib/db.ts'

const records = Number(process.argv[process.argv.indexOf('--records') + 1]) || 50_000

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const dbName = new URL(url).pathname.replace(/^\//, '')
if (!/_(bench|test)$/.test(dbName)) {
  throw new Error(`Refusing to seed "${dbName}": the database name must end in _bench or _test`)
}

const prisma = connect(url)
const run = (sql: string) => prisma.$executeRawUnsafe(sql)

async function main() {
  const started = Date.now()
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  await run(`TRUNCATE TABLE ${tables.map(t => `"public"."${t.tablename}"`).join(', ')} CASCADE`)

  // Activity is tracked from 200 days ago, so the whole seeded history counts.
  await run(`INSERT INTO "Workspace" (id, name, "updatedAt", "activityTrackedSince")
             VALUES ('bench', 'Benchmark', now(), now() - interval '200 days')`)

  // People: u_admin, u_sup0 (head), u_sup1..3 under it, u_lab1..48 under sup1..3.
  await run(`
    INSERT INTO "User" (id, username, email, name, "mustResetPassword", "updatedAt")
    SELECT id, id, id || '@bench.local', initcap(replace(id, '_', ' ')), false, now()
      FROM (SELECT 'u_admin' AS id
            UNION ALL SELECT 'u_sup' || g FROM generate_series(0, 3) g
            UNION ALL SELECT 'u_lab' || g FROM generate_series(1, 48) g) people`)
  await run(`
    INSERT INTO "WorkspaceMembership" (id, "workspaceId", "userId", role, status, "supervisorMembershipId", "lastSeenAt", "updatedAt")
    VALUES ('m_admin', 'bench', 'u_admin', 'admin', 'active', NULL, now(), now()),
           ('m_sup0', 'bench', 'u_sup0', 'supervisor', 'active', NULL, now(), now())`)
  await run(`
    INSERT INTO "WorkspaceMembership" (id, "workspaceId", "userId", role, status, "supervisorMembershipId", "lastSeenAt", "updatedAt")
    SELECT 'm_sup' || g, 'bench', 'u_sup' || g, 'supervisor', 'active', 'm_sup0', now() - g * interval '1 day', now()
      FROM generate_series(1, 3) g`)
  await run(`
    INSERT INTO "WorkspaceMembership" (id, "workspaceId", "userId", role, status, "supervisorMembershipId", "lastSeenAt", "updatedAt")
    SELECT 'm_lab' || g, 'bench', 'u_lab' || g, 'labeller',
           (CASE WHEN g % 4 = 0 THEN 'suspended' ELSE 'active' END)::"MembershipStatus",
           'm_sup' || (1 + g % 3), CASE WHEN g % 7 = 0 THEN NULL ELSE now() - g * interval '1 hour' END, now()
      FROM generate_series(1, 48) g`)

  // Taxonomies: A has 10 x 10 x 5 (500 leaves), B 20 x 10 (200 leaves).
  await run(`INSERT INTO "Taxonomy" (id, "workspaceId", key, "maxDepth", "updatedAt")
             VALUES ('t_a', 'bench', 'A', 3, now()), ('t_b', 'bench', 'B', 2, now())`)
  await run(`
    INSERT INTO "TaxonomyNode" (id, "workspaceId", "taxonomyId", code, label, level, "parentCode", "isLeaf")
    SELECT 'n_a1_' || a, 'bench', 't_a', lpad(a::text, 2, '0'), 'A group ' || a, 1, NULL, false
      FROM generate_series(1, 10) a
    UNION ALL
    SELECT 'n_a2_' || a || '_' || b, 'bench', 't_a', lpad(a::text, 2, '0') || b, 'A sub ' || a || b, 2, lpad(a::text, 2, '0'), false
      FROM generate_series(1, 10) a, generate_series(0, 9) b
    UNION ALL
    SELECT 'n_a3_' || a || '_' || b || '_' || c, 'bench', 't_a', lpad(a::text, 2, '0') || b || c, 'A item', 3,
           lpad(a::text, 2, '0') || b, true
      FROM generate_series(1, 10) a, generate_series(0, 9) b, generate_series(0, 4) c
    UNION ALL
    SELECT 'n_b1_' || a, 'bench', 't_b', lpad(a::text, 2, '0'), 'B group ' || a, 1, NULL, false
      FROM generate_series(1, 20) a
    UNION ALL
    SELECT 'n_b2_' || a || '_' || b, 'bench', 't_b', lpad(a::text, 2, '0') || b, 'B item', 2, lpad(a::text, 2, '0'), true
      FROM generate_series(1, 20) a, generate_series(0, 9) b`)

  // Records. field1 mixes a job title with noise so text search has realistic selectivity.
  await run(`INSERT INTO "SentenceImport" (id, "workspaceId", "fileName", "totalRows")
             VALUES ('imp', 'bench', 'bench.csv', ${records})`)
  await run(`
    INSERT INTO "Sentence" (id, "workspaceId", "recordKey", "importId", "importOrder", field1, field2, "fieldMapping",
                            flagged, status, "lastEditorId", "lastEditedAt", "createdAt")
    SELECT 's' || i, 'bench', lpad(i::text, 7, '0'), 'imp', i,
           (ARRAY['software engineer','primary school teacher','nurse','truck driver','accountant','farm worker',
                  'shop assistant','electrician','cook','cleaner','civil engineer','police officer','tailor',
                  'mechanic','carpenter','bank clerk','pharmacist','security guard','plumber','waiter'])[1 + i % 20]
             || ' ' || substr(md5(i::text), 1, 12),
           CASE WHEN i % 3 = 0 THEN 'works in ' || substr(md5((i * 7)::text), 1, 8) END,
           '{"1": "job_title", "2": "description"}'::jsonb,
           i % 33 = 0,
           (CASE WHEN i % 50 = 0 THEN 'escalated'
                 WHEN i % 20 = 19 THEN 'skipped'
                 WHEN i % 10 < 4 THEN 'submitted'
                 ELSE 'pending' END)::"SentenceStatus",
           CASE WHEN i % 10 < 7 THEN 'u_lab' || (1 + i % 48) END,
           CASE WHEN i % 10 < 7 THEN now() - ((i * 7919) % 180) * interval '1 day' - (i % 600) * interval '1 minute' END,
           now() - interval '200 days'
      FROM generate_series(1, ${records}) i`)
  await run(`
    INSERT INTO "SentenceAssignment" (id, "workspaceId", "sentenceId", "membershipId")
    SELECT 'sa' || i, 'bench', 's' || i, 'm_lab' || (1 + i % 48) FROM generate_series(1, ${records}) i
    UNION ALL
    SELECT 'sb' || i, 'bench', 's' || i, 'm_lab' || (1 + (i + 7) % 48) FROM generate_series(1, ${records}) i WHERE i % 5 = 0`)

  // Human labels: taxonomy A on 70% of records (3 levels), B on 40% (2 levels).
  const labeledAt = `now() - ((i * 7919) % 180) * interval '1 day' - (i % 600) * interval '1 minute'`
  const pathA = `lpad((1 + i % 10)::text, 2, '0')`
  await run(`
    INSERT INTO "SentenceAnnotation" (id, "workspaceId", "sentenceId", "taxonomyId", level, "nodeCode", source,
                                      "createdById", "labelingStartedAt", "createdAt", "updatedAt")
    SELECT 'aa' || i || '_' || l, 'bench', 's' || i, 't_a', l,
           CASE l WHEN 1 THEN ${pathA} WHEN 2 THEN ${pathA} || (i % 10) ELSE ${pathA} || (i % 10) || (i % 5) END,
           'user'::"AnnotationSource", 'u_lab' || (1 + i % 48), ${labeledAt} - (30 + i % 300) * interval '1 second', ${labeledAt}, ${labeledAt}
      FROM generate_series(1, ${records}) i, generate_series(1, 3) l WHERE i % 10 < 7
    UNION ALL
    SELECT 'ab' || i || '_' || l, 'bench', 's' || i, 't_b', l,
           CASE l WHEN 1 THEN lpad((1 + i % 20)::text, 2, '0') ELSE lpad((1 + i % 20)::text, 2, '0') || (i % 10) END,
           'user'::"AnnotationSource", 'u_lab' || (1 + i % 48), NULL, ${labeledAt}, ${labeledAt}
      FROM generate_series(1, ${records}) i, generate_series(1, 2) l WHERE i % 10 < 4`)

  // Activity: one event per label save; every third A-record was saved again
  // (by the shared second labeller when there is one) a few days later.
  await run(`
    INSERT INTO "LabelingActivity" (id, "workspaceId", "sentenceId", "taxonomyId", "actorId", "operationId", "createdAt")
    SELECT 'ea' || i, 'bench', 's' || i, 't_a', 'u_lab' || (1 + i % 48), 'op_a' || i, ${labeledAt}
      FROM generate_series(1, ${records}) i WHERE i % 10 < 7
    UNION ALL
    SELECT 'eb' || i, 'bench', 's' || i, 't_b', 'u_lab' || (1 + i % 48), 'op_b' || i, ${labeledAt} + interval '5 minutes'
      FROM generate_series(1, ${records}) i WHERE i % 10 < 4
    UNION ALL
    SELECT 'er' || i, 'bench', 's' || i, 't_a',
           'u_lab' || (CASE WHEN i % 5 = 0 THEN 1 + (i + 7) % 48 ELSE 1 + i % 48 END),
           'op_r' || i, ${labeledAt} + (1 + i % 4) * interval '1 day'
      FROM generate_series(1, ${records}) i WHERE i % 10 < 7 AND i % 3 = 0`)

  // AI suggestions on 30% (taxonomy A), two thirds agreeing with the human label.
  await run(`
    INSERT INTO "SentenceAISuggestion" (id, "workspaceId", "sentenceId", "taxonomyId", level, "nodeCode", "confidenceScore")
    SELECT 'g' || i || '_' || l, 'bench', 's' || i, 't_a', l,
           CASE WHEN i % 3 = 2 THEN '99' ELSE
             CASE l WHEN 1 THEN ${pathA} WHEN 2 THEN ${pathA} || (i % 10) ELSE ${pathA} || (i % 10) || (i % 5) END
           END,
           0.5 + (i % 50) / 100.0
      FROM generate_series(1, ${records}) i, generate_series(1, 3) l WHERE i % 10 < 3`)

  await run(`
    INSERT INTO "Comment" (id, "workspaceId", "sentenceId", "authorId", body, "createdAt")
    SELECT 'c' || i, 'bench', 's' || i, 'u_lab' || (1 + i % 48), 'Please check', ${labeledAt}
      FROM generate_series(1, ${records}) i WHERE i % 50 = 1`)

  await run('ANALYZE')
  const counts = await prisma.$queryRaw<Array<Record<string, number>>>`
    SELECT (SELECT count(*)::int FROM "Sentence") AS records,
           (SELECT count(*)::int FROM "SentenceAssignment") AS assignments,
           (SELECT count(*)::int FROM "SentenceAnnotation") AS annotations,
           (SELECT count(*)::int FROM "LabelingActivity") AS activity,
           (SELECT count(*)::int FROM "SentenceAISuggestion") AS suggestions`
  console.log(`✓ Seeded workspace "bench" in ${((Date.now() - started) / 1000).toFixed(1)} s:`, counts[0])
}

main()
  .catch(error => {
    console.error('✗ Seeding failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
