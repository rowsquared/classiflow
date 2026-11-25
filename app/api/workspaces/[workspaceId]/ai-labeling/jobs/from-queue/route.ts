import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { queueAIRequest } from '@/lib/contracts/ai-queue'
import { QueueAIError, queueAIJobs } from '@/lib/server/ai-queue'

export const POST = workspaceRoute(['admin'], async (req, { user }) => {
  const input = queueAIRequest.safeParse(await req.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: 'Invalid AI queue request.' }, { status: 400 })

  try {
    return NextResponse.json(await queueAIJobs(user, input.data))
  } catch (error) {
    if (error instanceof QueueAIError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
})
