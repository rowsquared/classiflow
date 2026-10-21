import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

/**
 * Connections per app instance. Prisma 7 talks to PostgreSQL through the `pg`
 * driver, whose pool defaults differ from Prisma 6, so the size is explicit.
 * Budget: instances × DATABASE_POOL_SIZE must stay below the server's
 * max_connections (100 by default), minus room for migrations and psql.
 */
const POOL_SIZE = Number(process.env.DATABASE_POOL_SIZE) || 10

export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: POOL_SIZE })
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
