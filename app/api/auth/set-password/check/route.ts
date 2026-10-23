import { NextResponse } from 'next/server'
import { checkAccountLink } from '@/lib/server/accounts'
import { allowRequest, clientIp } from '@/lib/rate-limit'

/**
 * Public. Whether a password link is good, and for which account; spends
 * nothing, so a mail scanner that opens the link cannot use it up.
 */
export async function POST(req: Request) {
  if (!(await allowRequest(`password-link:${clientIp(req)}`, { windowSeconds: 900, max: 30 }))) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null
  const link = await checkAccountLink(body?.token)
  if (!link) return NextResponse.json({ error: 'This link is invalid, used or expired' }, { status: 404 })
  return NextResponse.json({ ok: true, username: link.username, email: link.email, purpose: link.purpose })
}
