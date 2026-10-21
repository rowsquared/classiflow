import { execSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

export const ADMIN = { username: 'e2e-admin', password: 'e2e-password-123' }
export const RECORDS = ['software developer', 'hospital nurse', 'primary school teacher']

/** Migrates E2E_DATABASE_URL (name must end in _test), empties it and seeds the journeys' data. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL
  if (!url) throw new Error('E2E_DATABASE_URL is not set (a disposable database whose name ends in _test)')
  const dbName = new URL(url).pathname.replace(/^\//, '')
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to seed "${dbName}": the database name must end in _test`)

  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' })

  const prisma = new PrismaClient({ datasourceUrl: url })
  try {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map(t => `"public"."${t.tablename}"`).join(', ')} CASCADE`)

    const admin = await prisma.user.create({
      data: {
        username: ADMIN.username,
        email: 'e2e-admin@test.local',
        name: 'E2E Admin',
        role: 'admin',
        password: await bcrypt.hash(ADMIN.password, 10),
        mustResetPassword: false,
      },
    })
    await prisma.user.create({
      data: { username: 'e2e-labeller', email: 'e2e-labeller@test.local', name: 'E2E Labeller', role: 'labeller', password: 'x' },
    })
    const taxonomy = await prisma.taxonomy.create({ data: { key: 'ISCO', maxDepth: 2, levelNames: { '1': 'Group', '2': 'Item' } } })
    await prisma.taxonomyNode.createMany({
      data: [
        { taxonomyId: taxonomy.id, code: '01', label: 'Professionals', level: 1, parentCode: null, isLeaf: false },
        { taxonomyId: taxonomy.id, code: '011', label: 'Teachers', level: 2, parentCode: '01', isLeaf: true },
        { taxonomyId: taxonomy.id, code: '012', label: 'Health professionals', level: 2, parentCode: '01', isLeaf: true },
        { taxonomyId: taxonomy.id, code: '02', label: 'Technicians', level: 1, parentCode: null, isLeaf: true },
      ],
    })
    const imp = await prisma.sentenceImport.create({ data: { fileName: 'e2e.csv', totalRows: RECORDS.length } })
    for (const [i, text] of RECORDS.entries()) {
      await prisma.sentence.create({
        data: {
          importId: imp.id,
          importOrder: i,
          field1: text,
          fieldMapping: { '1': 'job_title' },
          assignments: { create: [{ userId: admin.id }] },
        },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}
