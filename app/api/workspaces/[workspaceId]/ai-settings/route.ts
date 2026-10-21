import { NextResponse } from 'next/server'
import { z } from 'zod'
import { workspaceRoute } from '@/lib/api-auth'
import { AI_UNAVAILABLE_MESSAGES, setWorkspaceAIEnabled, workspaceAISettings } from '@/lib/ai-connections'
import { audit } from '@/lib/audit'

// The workspace's AI settings (workspace admins): whether AI is on, its
// connection versions and the approved endpoints to choose from. Credentials
// are write-only (./connection) and never returned.

export const GET = workspaceRoute(['admin'], async () => {
  return NextResponse.json(await workspaceAISettings())
})

const updateSchema = z.object({ enabled: z.boolean() })

// PUT: turn AI on or off for new jobs. Jobs already queued or running are not affected.
export const PUT = workspaceRoute(['admin'], async (req, { user: actor }) => {
  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const unavailable = await setWorkspaceAIEnabled(parsed.data.enabled)
  if (unavailable) {
    return NextResponse.json({ error: AI_UNAVAILABLE_MESSAGES[unavailable], code: unavailable }, { status: 409 })
  }
  await audit({
    actorId: actor.id,
    action: parsed.data.enabled ? 'ai.enabled' : 'ai.disabled',
    entityType: 'workspace',
    entityId: actor.workspaceId,
    payload: { authority: actor.authority }
  })
  return NextResponse.json(await workspaceAISettings())
})
