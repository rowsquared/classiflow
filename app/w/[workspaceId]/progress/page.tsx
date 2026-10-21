import LoadError from '@/components/LoadError'
import { asJson } from '@/lib/server/json'
import { requirePageUser } from '@/lib/server/page-user'
import { withWorkspace } from '@/lib/workspace/db'
import { getProgressStats, getProgressTimeline, getTeamProgress } from '@/lib/server/progress'
import ProgressPageClient, {
  type Stats,
  type Timeline,
  type TeamMember,
  type Period
} from './ProgressPageClient'

const DEFAULT_PERIOD: Period = 'week'

function getDateRange(period: Period, customStart?: string, customEnd?: string) {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setHours(0, 0, 0, 0)

  switch (period) {
    case 'day':
      break
    case 'week':
      start.setDate(start.getDate() - 6)
      break
    case 'month':
      start.setDate(start.getDate() - 29)
      break
    case 'custom':
      if (customStart && customEnd) {
        return {
          startDate: new Date(customStart).toISOString(),
          endDate: new Date(customEnd).toISOString()
        }
      }
      break
  }

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString()
  }
}

export default async function ProgressPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await requirePageUser(workspaceId)

  const { startDate, endDate } = getDateRange(DEFAULT_PERIOD)
  const range = { start: new Date(startDate), end: new Date(endDate) }

  let data
  try {
    const [stats, timeline, team] = await withWorkspace(workspaceId, () => Promise.all([
      getProgressStats(user, range),
      getProgressTimeline(user, range, 'day'),
      user.role === 'admin' || user.role === 'supervisor' ? getTeamProgress(user, range) : null,
    ]))
    data = asJson({ stats, timeline: timeline.timeline, team: team?.team ?? [] })
  } catch (error) {
    console.error('Progress page failed to load:', error)
    return <LoadError title="Progress" what="the progress figures" />
  }

  return (
    <ProgressPageClient
      initialStats={data.stats as Stats}
      initialTimeline={data.timeline as Timeline[]}
      initialTeam={data.team as TeamMember[]}
      userRole={user.role}
      defaultPeriod={DEFAULT_PERIOD}
    />
  )
}
