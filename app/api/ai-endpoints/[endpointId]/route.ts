import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePlatformAdmin } from '@/lib/api-auth'
import { retireEndpoint, setEndpointAccess } from '@/lib/ai-connections'
import { audit } from '@/lib/audit'

type Params = { params: Promise<{ endpointId: string }> }

const accessSchema = z.object({
  allWorkspaces: z.boolean(),
  workspaceIds: z.array(z.string().min(1).max(100)).max(1000).default([])
})

// PUT: which workspaces may use the endpoint: all, or only the listed ones.
// Workspaces that lose access start no new jobs on it; running jobs finish.
export async function PUT(req: Request, { params }: Params) {
  const { user: actor, error } = await requirePlatformAdmin()
  if (error) return error
  const { endpointId } = await params
  const parsed = accessSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const result = await setEndpointAccess({ endpointId, ...parsed.data, actorId: actor.id })
  if (!result) return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 })
  if ('unknownWorkspaces' in result) {
    return NextResponse.json({ error: 'Unknown workspaces', workspaceIds: result.unknownWorkspaces }, { status: 400 })
  }
  await audit({
    workspaceId: null,
    actorId: actor.id,
    action: 'ai.endpoint_access_changed',
    entityType: 'ai_endpoint',
    entityId: endpointId,
    payload: { allWorkspaces: result.allWorkspaces, workspaceIds: result.workspaceIds }
  })
  return NextResponse.json({ endpoint: result })
}

// DELETE: retire an approved endpoint. Workspaces can no longer connect to it
// or start jobs on it; jobs already running there finish.
export async function DELETE(_req: Request, { params }: Params) {
  const { user: actor, error } = await requirePlatformAdmin()
  if (error) return error
  const { endpointId } = await params
  if (!(await retireEndpoint(endpointId))) {
    return NextResponse.json({ error: 'Endpoint not found or already retired' }, { status: 404 })
  }
  await audit({
    workspaceId: null,
    actorId: actor.id,
    action: 'ai.endpoint_retired',
    entityType: 'ai_endpoint',
    entityId: endpointId
  })
  return NextResponse.json({ ok: true })
}
