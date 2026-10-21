import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkInvitation } from '@/lib/server/invitations'
import { allowRequest, clientIp } from '@/lib/rate-limit'

/**
 * Public. What an invitation link offers (workspace name and role) and, when
 * someone is signed in, whether it was sent to their address. Spends nothing.
 */
export async function POST(req: Request) {
  if (!(await allowRequest(`invitation:${clientIp(req)}`, { windowSeconds: 900, max: 30 }))) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null
  const session = await getSession()
  const user = session?.user?.id
    ? { id: session.user.id, platformRole: session.user.role === 'admin' ? ('admin' as const) : ('user' as const) }
    : null
  const result = await checkInvitation(body?.token, user)
  if (!result) {
    return NextResponse.json({ error: 'This invitation is invalid, used or expired' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, ...result, signedIn: !!user })
}
