import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/api-auth'
import { retireEndpoint } from '@/lib/ai-connections'
import { audit } from '@/lib/audit'

type Params = { params: Promise<{ endpointId: string }> }

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
