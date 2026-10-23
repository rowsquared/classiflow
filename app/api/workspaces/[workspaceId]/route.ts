import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePlatformAdmin } from '@/lib/api-auth'
import { deleteWorkspace } from '@/lib/server/workspaces'
import { logError } from '@/lib/logger'
import { notFound, requireWorkspace } from '@/lib/api-auth'
import { updateWorkspace } from '@/lib/server/workspaces'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ workspaceId: string }> }

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['active', 'archived']).optional()
})

export async function DELETE(req: Request, { params }: Params) {
  const { user, error } = await requirePlatformAdmin()
  if (error) return error
  const body = z.object({ name: z.string().min(1).max(200) }).safeParse(await req.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: 'Type the exact workspace name to confirm deletion' }, { status: 400 })
  const { workspaceId } = await params
  try {
    const result = await deleteWorkspace(workspaceId, body.data.name, user.id)
    return NextResponse.json(result, { status: result.status })
  } catch (caught) {
    await logError('Could not delete workspace', caught, { workspaceId })
    return NextResponse.json({ error: 'Could not delete workspace. No local data was deleted.' }, { status: 500 })
  }
}

// GET: the workspace and the caller's effective role in it.
export async function GET(_req: Request, { params }: Params) {
  const { workspaceId } = await params
  const { user, error } = await requireWorkspace(workspaceId)
  if (error) return error
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      archivedAt: true,
      createdAt: true
    }
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
  try {
    const result = await updateWorkspace(actor, parsed.data)
    return NextResponse.json(result, { status: result.status })
  } catch (caught) {
    await logError('Could not update workspace', caught, { workspaceId })
    return NextResponse.json({ error: 'Could not update workspace' }, { status: 500 })
  }
}
