import QueuePageClient, {
  type QueueResponse,
  type Stats,
  type Taxonomy,
  type QueueUser
} from './QueuePageClient'
import LoadError from '@/components/LoadError'
import { asJson } from '@/lib/server/json'
import { requirePageUser } from '@/lib/server/page-user'
import { withWorkspace } from '@/lib/workspace/db'
import { getQueueStats, listQueue } from '@/lib/server/sentences'
import { listActiveTaxonomies } from '@/lib/server/taxonomies'
import { getVisibleUser, listVisibleUsers } from '@/lib/server/users'

export default async function QueuePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await requirePageUser(workspaceId)

  const queueParams = new URLSearchParams({
    page: '1',
    limit: '100',
    sort: 'createdAt',
    order: 'asc',
    status: 'pending'
  })

  let data
  try {
    const [queue, stats, taxonomies, users, self] = await withWorkspace(workspaceId, () => Promise.all([
      listQueue(user, queueParams),
      getQueueStats(user, new URLSearchParams()),
      listActiveTaxonomies(workspaceId),
      user.role === 'admin' || user.role === 'supervisor' ? listVisibleUsers(user) : null,
      user.role === 'supervisor' ? getVisibleUser(user, user.id) : null,
    ]))
    data = asJson({ queue, stats: stats.stats, taxonomies: taxonomies.taxonomies, users: users?.users ?? [], self })
  } catch (error) {
    console.error('Queue page failed to load:', error)
    return <LoadError title="Queue" what="the queue" />
  }

  const users: QueueUser[] = data.users.map(u => ({ id: u.id, username: u.username, name: u.name }))
  // Supervisors assign only when they have labellers below them.
  const canAssign = user.role === 'admin' ||
    (data.self !== null && data.self !== 'forbidden' && data.self.labellers.length > 0)

  return (
    <QueuePageClient
      initialQueue={data.queue as QueueResponse}
      initialStats={data.stats as Stats}
      initialTaxonomies={data.taxonomies as Taxonomy[]}
      initialUsers={users}
      initialCanAssign={canAssign}
      initialStatsPrefetched
      currentUser={{ id: user.id, role: user.role }}
    />
  )
}
