import { NextResponse } from 'next/server'
import { z } from 'zod'
import { mailEnabled } from '@/lib/mail/config'
import { runAfterResponse } from '@/lib/after-response'
import { requestPasswordLink } from '@/lib/server/accounts'
import { allowRequest, clientIp } from '@/lib/rate-limit'

const bodySchema = z.object({ email: z.string().trim().email().max(254) })

const ANSWER = {
  ok: true,
  message: 'If an account uses this address, a link to choose a new password is on its way.'
}

/**
 * Public. Answers identically for every well-formed address and looks
 * nothing up during the request: the account lookup and the mail happen after
 * the response (lib/server/accounts.ts). Not available without mail.
 */
export async function POST(req: Request) {
  if (!mailEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  if (!(await allowRequest(`forgot-password:${clientIp(req)}`, { windowSeconds: 900, max: 5 }))) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }
  const email = parsed.data.email
  runAfterResponse(() => requestPasswordLink(email))
  return NextResponse.json(ANSWER)
}
