import { NextResponse } from 'next/server'
import { z } from 'zod'
import { workspaceRoute } from '@/lib/api-auth'
import { mailEnabled } from '@/lib/mail/config'
import { inviteToWorkspace, listInvitations } from '@/lib/server/invitations'

const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform(e => e.toLowerCase()),
  role: z.enum(['admin', 'supervisor', 'labeller']),
  supervisorId: z.string().nullable().optional()
})

// Open invitations to this workspace (workspace admins).
export const GET = workspaceRoute(['admin'], async (_req, { user }) => {
  return NextResponse.json({ invitations: await listInvitations(user.workspaceId), mailEnabled: mailEnabled() })
})

// Invite an email address. The answer is the same whether or not an account
// uses the address (lib/server/invitations.ts).
export const POST = workspaceRoute(['admin'], async (req, { user }) => {
  if (!mailEnabled()) {
    return NextResponse.json({ error: 'Invitations need email, which is not configured' }, { status: 409 })
  }
  const parsed = inviteSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const result = await inviteToWorkspace(user, {
    email: parsed.data.email,
    role: parsed.data.role,
    supervisorId: parsed.data.supervisorId ?? null
  })
  if ('error' in result) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result, { status: 201 })
})
