import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'

/**
 * Fixed-window request limits for the public account endpoints (forgotten
 * password, password links, invitations), counted in the database (Better
 * Auth's RateLimit table, keys prefixed `classiflow:`), so every instance
 * shares them. One atomic upsert per request.
 */
export async function allowRequest(key: string, { windowSeconds, max }: { windowSeconds: number; max: number }) {
  const now = Date.now()
  const windowStart = now - windowSeconds * 1000
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimit" (id, key, count, "lastRequest")
    VALUES (${randomUUID()}, ${`classiflow:${key}`}, 1, ${BigInt(now)})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "RateLimit"."lastRequest" < ${BigInt(windowStart)} THEN 1 ELSE "RateLimit".count + 1 END,
      "lastRequest" = CASE WHEN "RateLimit"."lastRequest" < ${BigInt(windowStart)} THEN ${BigInt(now)} ELSE "RateLimit"."lastRequest" END
    RETURNING count`
  return (rows[0]?.count ?? 0) <= max
}

/** The client address as the reverse proxy reports it (first X-Forwarded-For entry). */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown'
}
