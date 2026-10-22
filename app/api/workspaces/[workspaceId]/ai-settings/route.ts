import { NextResponse } from 'next/server'
import { z } from 'zod'
import { workspaceRoute } from '@/lib/api-auth'
import {
  AI_UNAVAILABLE_MESSAGES,
  setWorkspaceAIEnabled,
  setWorkspaceJobSettings,
  workspaceAISettings
} from '@/lib/ai-connections'
import { audit } from '@/lib/audit'

// The workspace's AI settings (workspace admins): whether AI is on, its
// connection versions, the approved endpoints to choose from and the job
// settings (batch sizes, learning threshold). Credentials are write-only
// (./connection) and never returned.

export const GET = workspaceRoute(['admin'], async () => {
  return NextResponse.json(await workspaceAISettings())
})

// null: back to the deployment default.
const batchSize = z.number().int().min(1).max(100_000).nullable().optional()
const updateSchema = z
  .object({
    enabled: z.boolean().optional(),
    jobSettings: z
      .object({
        labelingBatchSize: batchSize,
        learningBatchSize: batchSize,
        learningMinNewAnnotations: z.number().int().min(0).max(1_000_000).nullable().optional()
      })
      .strict()
      .optional()
  })
  .refine(body => body.enabled !== undefined || body.jobSettings !== undefined, 'Nothing to change')

// PUT: turn AI on or off for new jobs and/or change the job settings. Jobs
// already queued or running are not affected.
export const PUT = workspaceRoute(['admin'], async (req, { user: actor }) => {
  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsed.error.issues }, { status: 400 })
  }
  const { enabled, jobSettings } = parsed.data
  if (jobSettings) {
    await setWorkspaceJobSettings(jobSettings)
    await audit({
      actorId: actor.id,
      action: 'ai.job_settings_changed',
      entityType: 'workspace',
      entityId: actor.workspaceId,
      payload: { ...jobSettings, authority: actor.authority }
    })
  }
  if (enabled !== undefined) {
    const unavailable = await setWorkspaceAIEnabled(enabled)
    if (unavailable) {
      return NextResponse.json({ error: AI_UNAVAILABLE_MESSAGES[unavailable], code: unavailable }, { status: 409 })
    }
    await audit({
      actorId: actor.id,
      action: enabled ? 'ai.enabled' : 'ai.disabled',
      entityType: 'workspace',
      entityId: actor.workspaceId,
      payload: { authority: actor.authority }
    })
  }
  return NextResponse.json(await workspaceAISettings())
})
