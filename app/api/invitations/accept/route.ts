import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { acceptInvitation } from '@/lib/server/invitations'
import { allowRequest, clientIp } from '@/lib/rate-limit'

// Accepts a workspace invitation for the signed-in account (lib/server/invitations.ts).
export async function POST(req: Request) {
  const { user, error } = await requireSession()
  if (error) return error
  if (!(await allowRequest(`invitation:${clientIp(req)}`, { windowSeconds: 900, max: 30 }))) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null
  const result = await acceptInvitation(body?.token, user)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, workspaceId: result.workspaceId })
}
