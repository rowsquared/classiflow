import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { db } from '@/lib/workspace/db'
import type { CaughtError } from '@/lib/utils'

export const GET = workspaceRoute(['admin'], async (req, { params: routeParams }) => {
  try {
    const { jobId } = routeParams
    const job = await db().aILabelingJob.findUnique({
      where: { id: jobId },
      include: {
        taxonomy: { select: { key: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, job })
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Failed to fetch AI labeling job:', error)
    return NextResponse.json({ error: error?.message || 'Failed to fetch job' }, { status: 500 })
  }
})

