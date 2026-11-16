import { NextResponse } from 'next/server'
import { z } from 'zod'
import { workspaceRoute } from '@/lib/api-auth'
import {
  ConnectionInputError,
  approvedEndpoint,
  createConnectionVersion,
  removeActiveConnection,
  workspaceAISettings
} from '@/lib/ai-connections'
import { audit } from '@/lib/audit'
import { probeTaxomindConnection } from '@/lib/ai-labeling'
import { withWorkspace } from '@/lib/workspace/db'

// The workspace's AI connection (workspace admins). Write-only for the
// credential: it is encrypted on arrival and no response, log or audit entry
// ever contains it.

const connectionSchema = z.object({
  endpointId: z.string().min(1),
  credential: z.string().min(1).max(4096)
})

// POST: a new connection version (approved endpoint + credential). The
// previous version is retired; its running jobs finish with it.
export const POST = workspaceRoute(
  ['admin'],
  async (req, { user: actor }) => {
    const parsed = connectionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      // Zod issues can echo input values; never return them for this body.
      return NextResponse.json({ error: 'Choose an AI service and enter its access token' }, { status: 400 })
    }
    try {
      if (req.nextUrl.searchParams.get('test') === 'true') {
        const endpoint = await withWorkspace(actor.workspaceId, () => approvedEndpoint(parsed.data.endpointId))
        const result = await probeTaxomindConnection(endpoint.baseUrl, parsed.data.credential)
        if (result === 'rejected')
          return NextResponse.json({ error: 'The AI service refused this access token' }, { status: 422 })
        if (result === 'unavailable')
          return NextResponse.json({ error: 'Could not verify the AI service at this address' }, { status: 502 })
        return NextResponse.json({ ok: true })
      }
      return await withWorkspace(
        actor.workspaceId,
        async () => {
          const connection = await createConnectionVersion({ ...parsed.data, actorId: actor.id })
          await audit({
            actorId: actor.id,
            action: 'ai.connection_created',
            entityType: 'ai_connection',
            entityId: connection.id,
            payload: { version: connection.version, endpointId: connection.endpoint.id, authority: actor.authority }
          })
          return NextResponse.json(await workspaceAISettings(), { status: 201 })
        },
        { write: true }
      )
    } catch (caught) {
      if (caught instanceof ConnectionInputError) return NextResponse.json({ error: caught.message }, { status: 400 })
      throw caught
    }
  },
  { transaction: false }
)

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
