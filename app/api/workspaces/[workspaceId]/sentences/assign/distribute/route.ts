import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { distributionRequest } from '@/lib/contracts/distribution'
import { distributeWork, DistributionError } from '@/lib/server/distribution'

export const POST = workspaceRoute(['admin', 'supervisor'], async (req, { user }) => {
  const parsed = distributionRequest.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid distribution request.' }, { status: 400 })

  try {
    return NextResponse.json(await distributeWork(user, parsed.data))
  } catch (error) {
    if (error instanceof DistributionError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
})
