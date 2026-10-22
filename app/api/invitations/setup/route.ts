import { NextResponse } from 'next/server'
import { z } from 'zod'
import { setupInvitedAccount } from '@/lib/server/invitations'
import { allowRequest, clientIp } from '@/lib/rate-limit'
import { logError } from '@/lib/logger'

const schema = z.object({
  token: z.string().max(200),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(256)
})

// Public, token-gated account setup. Unrestricted signup remains disabled.
export async function POST(req: Request) {
  if (!(await allowRequest(`invitation:${clientIp(req)}`, { windowSeconds: 900, max: 30 })))
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a name and valid password' }, { status: 400 })
  try {
    const result = await setupInvitedAccount(parsed.data.token, parsed.data.name, parsed.data.password)
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: result.error }, { status: result.status })
  } catch (error) {
    await logError('Invitation account setup failed', error)
    return NextResponse.json({ error: 'Could not set up the account' }, { status: 500 })
  }
}
