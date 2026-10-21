import LoadError from '@/components/LoadError'
import { asJson } from '@/lib/server/json'
import { requirePageUser } from '@/lib/server/page-user'
import { withWorkspace } from '@/lib/workspace/db'
import { listVisibleUsers } from '@/lib/server/users'
import TeamPageClient, { type User } from './TeamPageClient'

export default async function TeamPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await requirePageUser(workspaceId, 'admin')

  let data
  try {
    data = asJson(await withWorkspace(workspaceId, () => listVisibleUsers(user, { includeSuspended: true })))
  } catch (error) {
    console.error('Team page failed to load:', error)
    return <LoadError title="Team Management" what="the team" />
  }

  return <TeamPageClient initialUsers={data.users as User[]} />
}
