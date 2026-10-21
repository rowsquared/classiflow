import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePlatformAdmin } from '@/lib/api-auth'
import { aiDeployment, approveEndpoint, EndpointUrlError, listEndpoints } from '@/lib/ai-connections'
import { audit } from '@/lib/audit'

// Approved AI service endpoints (control plane, platform admins). Workspace
// admins connect their workspace to one of these; they cannot enter any URL.

const approveSchema = z.object({
  name: z.string().trim().min(1).max(200),
  baseUrl: z.string().trim().min(1).max(2000)
})

export async function GET() {
  const { error } = await requirePlatformAdmin()
  if (error) return error
  const deployment = aiDeployment()
  return NextResponse.json({
    endpoints: await listEndpoints({ includeRetired: true }),
    deployment: {
      ready: deployment.ready,
      keysConfigured: deployment.keysConfigured,
      keysError: deployment.keysError,
      sourceSlugConfigured: deployment.sourceSlugConfigured
    }
  })
}

export async function POST(req: Request) {
  const { user: actor, error } = await requirePlatformAdmin()
  if (error) return error
  const parsed = approveSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  try {
    const endpoint = await approveEndpoint({ ...parsed.data, actorId: actor.id })
    await audit({
      workspaceId: null,
      actorId: actor.id,
      action: 'ai.endpoint_approved',
      entityType: 'ai_endpoint',
      entityId: endpoint.id,
      payload: { name: endpoint.name, baseUrl: endpoint.baseUrl }
    })
    return NextResponse.json({ endpoint }, { status: 201 })
  } catch (caught) {
    if (caught instanceof EndpointUrlError) return NextResponse.json({ error: caught.message }, { status: 400 })
    throw caught
  }
}
