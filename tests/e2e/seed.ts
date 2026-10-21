// Empties the e2e database and seeds the journeys' data: an admin, a labeller,
// a two-level taxonomy and three records. Run by global-setup.ts with plain
// Node (Prisma 7's generated client is ES modules, which Playwright's
// TypeScript loader cannot import).
import { connect } from '../../scripts/lib/db.ts'
import { setPassword } from '../../lib/passwords.ts'
import { ADMIN, RECORDS, WORKSPACE_ID } from './fixtures.ts'

const prisma = connect()
try {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map(t => `"public"."${t.tablename}"`).join(', ')} CASCADE`)

  const workspace = await prisma.workspace.create({ data: { id: WORKSPACE_ID, name: 'E2E workspace' } })
  const ws = workspace.id
  const admin = await prisma.user.create({
    data: {
      username: ADMIN.username,
      email: 'e2e-admin@test.local',
      name: 'E2E Admin',
      mustResetPassword: false,
      memberships: { create: { workspaceId: ws, role: 'admin' } },
    },
    include: { memberships: true },
  })
  await setPassword(prisma, admin.id, ADMIN.password)
  await prisma.user.create({
    data: {
      username: 'e2e-labeller', email: 'e2e-labeller@test.local', name: 'E2E Labeller',
      memberships: { create: { workspaceId: ws, role: 'labeller' } },
    },
  })
  const taxonomy = await prisma.taxonomy.create({ data: { workspaceId: ws, key: 'ISCO', maxDepth: 2, levelNames: { '1': 'Group', '2': 'Item' } } })
  await prisma.taxonomyNode.createMany({
    data: [
      { workspaceId: ws, taxonomyId: taxonomy.id, code: '01', label: 'Professionals', level: 1, parentCode: null, isLeaf: false },
      { workspaceId: ws, taxonomyId: taxonomy.id, code: '011', label: 'Teachers', level: 2, parentCode: '01', isLeaf: true },
      { workspaceId: ws, taxonomyId: taxonomy.id, code: '012', label: 'Health professionals', level: 2, parentCode: '01', isLeaf: true },
      { workspaceId: ws, taxonomyId: taxonomy.id, code: '02', label: 'Technicians', level: 1, parentCode: null, isLeaf: true },
    ],
  })
  const imp = await prisma.sentenceImport.create({ data: { workspaceId: ws, fileName: 'e2e.csv', totalRows: RECORDS.length } })
  for (const [i, text] of RECORDS.entries()) {
    await prisma.sentence.create({
      data: {
        workspaceId: ws,
        recordKey: String(i + 1),
        importId: imp.id,
        importOrder: i,
        field1: text,
        fieldMapping: { '1': 'job_title' },
        assignments: { create: [{ membershipId: admin.memberships[0]!.id }] },
      },
    })
  }
} finally {
  await prisma.$disconnect()
}
