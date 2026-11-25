import { redirect } from 'next/navigation'
import LoadError from '@/components/LoadError'
import { logError } from '@/lib/logger'
import { loadQueueUrlState, serializeQueueUrlState } from '@/lib/queue-url'
import { getDistributionLabellers } from '@/lib/server/distribution'
import { requirePageUser } from '@/lib/server/page-user'
import { withWorkspace } from '@/lib/workspace/db'
import DistributeWorkClient from './DistributeWorkClient'

export default async function DistributeWorkPage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { workspaceId } = await params
  const user = await requirePageUser(workspaceId, 'admin', 'supervisor')
  if (user.archived) redirect(`/w/${workspaceId}/queue`)
  const queue = serializeQueueUrlState(await loadQueueUrlState(await searchParams))

  let labellers
  try {
    labellers = await withWorkspace(workspaceId, () => getDistributionLabellers(user))
  } catch (error) {
    await logError('Could not load distribution labellers', error)
    return <LoadError title="Distribute work" what="the labeller list" />
  }
  return <DistributeWorkClient key={queue} queue={queue} labellers={labellers} />
}
