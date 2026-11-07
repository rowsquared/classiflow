import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

/**
 * Connections per app instance. Prisma 7 talks to PostgreSQL through the `pg`
 * driver, whose pool defaults differ from Prisma 6, so the size is explicit.
 * Budget: instances × DATABASE_POOL_SIZE must stay below the server's
 * max_connections (100 by default), minus room for migrations and psql.
 */
const POOL_SIZE = Number(process.env.DATABASE_POOL_SIZE) || 10

type Adapter = Awaited<ReturnType<PrismaPg['connect']>>
type Transaction = Awaited<ReturnType<Adapter['startTransaction']>>

/**
 * One transaction is one connection, which runs one statement at a time.
 * Prisma's query interpreter loads the relations of one query (`include`)
 * with Promise.all, so a transaction's statements can overlap; `pg` still
 * queues them but warns that it will stop doing so in pg 9. This adapter
 * runs each transaction's statements one after another itself.
 */
export class SerialTransactionPg extends PrismaPg {
  override async connect(): Promise<Adapter> {
    const adapter = await super.connect()
    const startTransaction = adapter.startTransaction.bind(adapter)
    adapter.startTransaction = async isolationLevel => serialize(await startTransaction(isolationLevel))
    return adapter
  }
}

function serialize(tx: Transaction): Transaction {
  let queue: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run)
    queue = result.catch(() => undefined)
    return result
  }
  const queryRaw = tx.queryRaw.bind(tx)
  const executeRaw = tx.executeRaw.bind(tx)
  tx.queryRaw = query => inTurn(() => queryRaw(query))
  tx.executeRaw = query => inTurn(() => executeRaw(query))
  return tx
}

export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  return new PrismaClient({
    adapter: new SerialTransactionPg({ connectionString, max: POOL_SIZE })
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
