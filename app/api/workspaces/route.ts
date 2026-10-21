import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePlatformAdmin, requireSession } from '@/lib/api-auth'
import { createWorkspace, listAccessibleWorkspaces } from '@/lib/server/workspaces'
import { audit } from '@/lib/audit'

// The workspace directory (control plane): the workspaces the caller may enter,
// and creating workspaces (platform admins).

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  // The first admin; defaults to the creating platform admin.
  adminUserId: z.string().optional()
})

export async function GET() {
  const { user, error } = await requireSession()
  if (error) return error
  return NextResponse.json({ workspaces: await listAccessibleWorkspaces(user) })
}

export async function POST(req: Request) {
  const { user: actor, error } = await requirePlatformAdmin()
  if (error) return error
  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const workspace = await createWorkspace({
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    adminUserId: parsed.data.adminUserId ?? actor.id,
    createdById: actor.id
  })
  if (!workspace) return NextResponse.json({ error: 'Admin user not found' }, { status: 400 })
  await audit({
    workspaceId: null,
    actorId: actor.id,
    action: 'workspace.created',
    entityType: 'workspace',
    entityId: workspace.id,
    payload: { name: workspace.name, adminUserId: parsed.data.adminUserId ?? actor.id }
  })
  return NextResponse.json({ workspace }, { status: 201 })
}
