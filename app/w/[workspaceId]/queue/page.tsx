import QueuePageClient, { type QueueResponse, type Stats, type Taxonomy, type QueueUser } from './QueuePageClient'
import LoadError from '@/components/LoadError'
import { asJson } from '@/lib/server/json'
import { requirePageUser } from '@/lib/server/page-user'
import { withWorkspace } from '@/lib/workspace/db'
import { getQueueStats, listQueue } from '@/lib/server/sentences'
import { listActiveTaxonomies } from '@/lib/server/taxonomies'
import { getVisibleUser, listVisibleUsers } from '@/lib/server/users'
import { loadQueueUrlState, queueListParams, queueStatsParams } from '@/lib/queue-url'
import { logError } from '@/lib/logger'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { queueParsers } from '@/lib/queue-url'
import { queuePreferenceCookie, rememberedQueueSearch } from '@/lib/queue-preferences'

export default async function QueuePage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { workspaceId } = await params
  const user = await requirePageUser(workspaceId)
  const requested = await searchParams
  // Explicit URLs (including cleared/default values) always win over the preference.
  if (!Object.keys(queueParsers).some(key => requested[key] !== undefined)) {
    const saved = rememberedQueueSearch((await cookies()).get(queuePreferenceCookie(workspaceId))?.value, user)
    if (saved) redirect(`/w/${workspaceId}/queue${saved}`)
  }

  // The same view the client shows for this URL (tab, search, filters, page).
  const view = await loadQueueUrlState(requested)
  const listParams = queueListParams(view)
  const statsParams = queueStatsParams(view)

  let data
  try {
    const [queue, stats, taxonomies, users, self] = await withWorkspace(workspaceId, () =>
      Promise.all([
        listQueue(user, new URLSearchParams(listParams)),
        getQueueStats(user, new URLSearchParams(statsParams)),
        listActiveTaxonomies(workspaceId),
        user.role === 'admin' || user.role === 'supervisor' ? listVisibleUsers(user) : null,
        user.role === 'supervisor' ? getVisibleUser(user, user.id) : null
      ])
    )
    data = asJson({ queue, stats: stats.stats, taxonomies: taxonomies.taxonomies, users: users?.users ?? [], self })
  } catch (error) {
    await logError('Queue page failed to load', error)
    return <LoadError title="Queue" what="the queue" />
  }

  const users: QueueUser[] = data.users.map(u => ({ id: u.id, username: u.username, name: u.name }))
  // Supervisors assign only when they have labellers below them.
  const canAssign =
    user.role === 'admin' || (data.self !== null && data.self !== 'forbidden' && data.self.labellers.length > 0)

  return (
    <QueuePageClient
      initialQueue={data.queue as QueueResponse}
      initialListParams={listParams}
      initialStats={data.stats as Stats}
      initialStatsParams={statsParams}
      initialTaxonomies={data.taxonomies as Taxonomy[]}
      initialUsers={users}
      initialCanAssign={canAssign}
      currentUser={{ id: user.id, role: user.role }}
    />
  )
}
