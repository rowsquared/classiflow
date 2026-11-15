import { isIP } from 'node:net'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

const SWEEP_INTERVAL_MS = 60 * 60 * 1000
const RETENTION_MS = 24 * SWEEP_INTERVAL_MS
let nextSweep = 0

/** Every instance shares the same fixed windows through an atomic upsert. */
export async function allowRequest(key: string, { windowSeconds, max }: { windowSeconds: number; max: number }) {
  const now = Date.now()
  const windowStart = now - windowSeconds * 1000
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "AppRateLimit" (key, count, "lastRequest")
    VALUES (${`classiflow:${key}`}, 1, ${BigInt(now)})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "AppRateLimit"."lastRequest" < ${BigInt(windowStart)} THEN 1
                   ELSE LEAST("AppRateLimit".count::bigint + 1, 2147483647)::integer END,
      "lastRequest" = CASE WHEN "AppRateLimit"."lastRequest" < ${BigInt(windowStart)} THEN ${BigInt(now)} ELSE "AppRateLimit"."lastRequest" END
    RETURNING count`
  if (now >= nextSweep) {
    nextSweep = now + SWEEP_INTERVAL_MS
    await prisma.appRateLimit
      .deleteMany({ where: { lastRequest: { lt: BigInt(now - RETENTION_MS) } } })
      .catch(error => {
        logger.warn({ err: error }, 'Could not prune expired rate limits')
      })
  }
  return (rows[0]?.count ?? 0) <= max
}

/** Read the address added by the outermost trusted hop, counting from the right. */
export function clientIp(req: Request): string {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)
  if (!Number.isSafeInteger(hops) || hops < 1) return 'unknown'
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')
  const address = forwarded?.at(-hops)?.trim()
  return address && isIP(address) ? address : 'unknown'
}
