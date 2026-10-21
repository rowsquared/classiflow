import { NextResponse } from 'next/server'
import { z } from 'zod'
import { confirmAccountLink } from '@/lib/server/accounts'
import { allowRequest, clientIp } from '@/lib/rate-limit'

const bodySchema = z.object({ token: z.string().max(200), newPassword: z.string().max(256) })

/**
 * Public. Sets the password from an invitation or password link and ends
 * every session; the person then signs in (no session is created here).
 */
export async function POST(req: Request) {
  if (!(await allowRequest(`password-link:${clientIp(req)}`, { windowSeconds: 900, max: 30 }))) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
  const result = await confirmAccountLink(parsed.data.token, parsed.data.newPassword)
  if (!result.ok) {
    return NextResponse.json({ error: result.error, field: result.field }, { status: result.status })
  }
  return NextResponse.json({ ok: true, username: result.username })
}
