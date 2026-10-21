import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { ensureJobsMonitored } from '@/lib/ai-job-monitor'
import { listActiveAIJobs } from '@/lib/server/ai-jobs'

// How long recently finished jobs are included in the response
const RECENT_WINDOW_MS = 30 * 60 * 1000 // 30 minutes

export const GET = workspaceRoute(
  ['admin'],
  async () => {
    try {
      // Trigger recovery for any orphaned jobs (rate-limited internally)
      try {
        await ensureJobsMonitored()
      } catch (err) {
        console.error('ensureJobsMonitored error:', err)
      }

      return NextResponse.json({ ok: true, jobs: await listActiveAIJobs(RECENT_WINDOW_MS) })
    } catch (error: unknown) {
      console.error('Failed to fetch active jobs:', error)
      return NextResponse.json({ error: 'Failed to fetch active jobs' }, { status: 500 })
    }
  },
  { passive: true }
) // polled by every page header: not a sign of a person there
