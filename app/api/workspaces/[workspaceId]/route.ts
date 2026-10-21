import { NextResponse } from 'next/server'
import { z } from 'zod'
import { notFound, requireWorkspace } from '@/lib/api-auth'
import { setWorkspaceStatus, updateWorkspace } from '@/lib/server/workspaces'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

type Params = { params: Promise<{ workspaceId: string }> }

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
})

// GET: the workspace and the caller's effective role in it.
export async function GET(_req: Request, { params }: Params) {
  const { workspaceId } = await params
  const { user, error } = await requireWorkspace(workspaceId)
  if (error) return error
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, description: true, status: true, archivedAt: true, createdAt: true },
  })
  if (!workspace) return notFound('Workspace not found')
  return NextResponse.json({ workspace, role: user.role, authority: user.authority })
}

// PUT: rename, describe, archive or reopen (workspace and platform admins).
// Archiving waits for writes in flight and makes the workspace read-only.
export async function PUT(req: Request, { params }: Params) {
  const { workspaceId } = await params
  const { user: actor, error } = await requireWorkspace(workspaceId, 'admin')
  if (error) return error
  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const { name, description, status } = parsed.data
  if (name !== undefined || description !== undefined) {
    if (actor.archived && status !== 'active') {
      return NextResponse.json({ error: 'This workspace is archived and read-only' }, { status: 409 })
    }
    await updateWorkspace(workspaceId, { name, description })
    await audit({
      workspaceId, actorId: actor.id, action: 'workspace.updated', entityType: 'workspace', entityId: workspaceId,
      payload: { fields: Object.keys({ ...(name !== undefined && { name }), ...(description !== undefined && { description }) }) },
    })
  }
  if (status !== undefined && (status === 'archived') !== actor.archived) {
    const cancelledJobs = await setWorkspaceStatus(workspaceId, status)
    await audit({
      workspaceId, actorId: actor.id,
      action: status === 'archived' ? 'workspace.archived' : 'workspace.reopened',
      entityType: 'workspace', entityId: workspaceId,
      payload: { authority: actor.authority, ...(status === 'archived' ? { cancelledJobs } : {}) },
    })
  }
  return NextResponse.json({ ok: true })
}
