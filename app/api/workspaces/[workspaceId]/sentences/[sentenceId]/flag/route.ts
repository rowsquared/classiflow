import { NextResponse } from 'next/server'
import { db } from '@/lib/workspace/db'
import { z } from 'zod'
import { workspaceRoute } from '@/lib/api-auth'
import { denyUnlessSentencesVisible } from '@/lib/access'

const flagSchema = z.object({
  flagged: z.boolean()
})

export const POST = workspaceRoute<'sentenceId'>([], async (req, { user, params: routeParams }) => {
  try {
    const { sentenceId } = routeParams
    const denied = await denyUnlessSentencesVisible(user, [sentenceId])
    if (denied) return denied

    const parsed = flagSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
    }
    const { flagged } = parsed.data

    await db().sentence.update({
      where: { id: sentenceId },
      data: { flagged }
    })

    return NextResponse.json({ success: true, flagged })
  } catch (error) {
    console.error('Flag update error:', error)
    return NextResponse.json({ error: 'Failed to update flag' }, { status: 500 })
  }
})
