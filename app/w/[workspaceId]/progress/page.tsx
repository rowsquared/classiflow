import LoadError from '@/components/LoadError'
import { asJson } from '@/lib/server/json'
import { requirePageUser } from '@/lib/server/page-user'
import { withWorkspace } from '@/lib/workspace/db'
import { logError } from '@/lib/logger'
import {
  getProgressActivity,
  getProgressOverview,
  getProgressPeople,
  ReportScopeError,
  searchReportMembers
} from '@/lib/server/progress'
import { reportFilterQuery, reportPeopleQuery, reportTimelineQuery } from '@/lib/contracts/progress'
import { activityParams, loadProgressUrlState, overviewParams, peopleParams } from '@/lib/progress-url'
import ProgressDashboard, { type InitialReports } from '@/components/progress/ProgressDashboard'

/**
 * The Progress dashboard (docs/archive/plans-2026-10/progress-dashboard.md). The server
 * renders the view the URL names with the same report functions and query
 * strings the client uses, so the client's queries start with this data and
 * mounting does not repeat the requests. A section that cannot load here
 * (a refused selector, an invalid range) starts empty and shows its error
 * from the client's own request.
 */
export default async function ProgressPage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { workspaceId } = await params
  const user = await requirePageUser(workspaceId)
  const view = await loadProgressUrlState(searchParams)
  const staff = user.role === 'admin' || user.role === 'supervisor'
  const query = {
    overview: overviewParams(view),
    activity: activityParams(view),
    people: peopleParams(view)
  }

  // A section's report, or null when it fails validation or the selector is refused.
  const settle = async <T,>(load: () => Promise<{ data?: T; error?: string }>): Promise<T | null> => {
    try {
      return (await load()).data ?? null
    } catch (error) {
      if (error instanceof ReportScopeError) return null
      throw error
    }
  }
  const entries = (params: string) => Object.fromEntries(new URLSearchParams(params))

  let data
  try {
    data = asJson(
      await withWorkspace(workspaceId, async () => {
        const overview = reportFilterQuery.safeParse(entries(query.overview))
        const activity = reportTimelineQuery.safeParse(entries(query.activity))
        const people = reportPeopleQuery.safeParse(entries(query.people))
        return {
          overview: overview.success ? await settle(() => getProgressOverview(user, overview.data)) : null,
          activity: activity.success ? await settle(() => getProgressActivity(user, activity.data)) : null,
          people: staff && people.success ? await settle(() => getProgressPeople(user, people.data)) : null,
          // Names for the selected team and person; the pickers search the server.
          selected: staff
            ? (
                await Promise.all(
                  [view.teamId, view.personId]
                    .filter((id): id is string => !!id)
                    .map(userId => searchReportMembers(user, { kind: 'person', userId, limit: 1 }))
                )
              ).flatMap(result => result.members)
            : []
        }
      })
    )
  } catch (error) {
    await logError('Progress page failed to load', error, { workspaceId })
    return <LoadError title="Progress" what="the progress figures" />
  }

  const initial: InitialReports = {
    params: query,
    overview: data.overview as InitialReports['overview'],
    activity: data.activity as InitialReports['activity'],
    people: data.people as InitialReports['people']
  }

  return <ProgressDashboard initial={initial} selected={data.selected} viewer={{ id: user.id, role: user.role }} />
}
