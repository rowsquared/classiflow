// Shared by the scripts in this folder. They run as plain `node scripts/x.ts`
// (Node 24 strips the types), so imports are relative and keep their .ts
// extension: the `@/` alias exists only for Next and Vitest.
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../lib/generated/prisma/client.ts'

export function connect(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1 }) })
}

export type { PrismaClient }
