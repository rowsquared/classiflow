import { NextResponse } from 'next/server'
import { z } from 'zod'
import { workspaceRoute } from '@/lib/api-auth'
import {
  ConnectionInputError,
  createConnectionVersion,
  removeActiveConnection,
  workspaceAISettings
} from '@/lib/ai-connections'
import { audit } from '@/lib/audit'

// The workspace's AI connection (workspace admins). Write-only for the
// credential: it is encrypted on arrival and no response, log or audit entry
// ever contains it.

const connectionSchema = z.object({
  endpointId: z.string().min(1),
  credential: z.string().min(1).max(4096)
})

// POST: a new connection version (approved endpoint + credential). The
// previous version is retired; its running jobs finish with it.
export const POST = workspaceRoute(['admin'], async (req, { user: actor }) => {
  const parsed = connectionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    // Zod issues can echo input values; never return them for this body.
    return NextResponse.json({ error: 'Choose an AI service and enter its access token' }, { status: 400 })
  }
  try {
    const connection = await createConnectionVersion({ ...parsed.data, actorId: actor.id })
    await audit({
      actorId: actor.id,
      action: 'ai.connection_created',
      entityType: 'ai_connection',
      entityId: connection.id,
      payload: { version: connection.version, endpointId: connection.endpoint.id, authority: actor.authority }
    })
    return NextResponse.json(await workspaceAISettings(), { status: 201 })
  } catch (caught) {
    if (caught instanceof ConnectionInputError) return NextResponse.json({ error: caught.message }, { status: 400 })
    throw caught
  }
})

// DELETE: retire the active connection and turn AI off.
export const DELETE = workspaceRoute(['admin'], async (_req, { user: actor }) => {
  if (await removeActiveConnection()) {
    await audit({
      actorId: actor.id,
      action: 'ai.connection_removed',
      entityType: 'workspace',
      entityId: actor.workspaceId,
      payload: { authority: actor.authority }
    })
  }
  return NextResponse.json(await workspaceAISettings())
})
