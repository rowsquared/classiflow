import LoadError from '@/components/LoadError'
import { asJson } from '@/lib/server/json'
import { requirePageUser } from '@/lib/server/page-user'
import { listVisibleUsers } from '@/lib/server/users'
import TeamPageClient, { type User } from './TeamPageClient'

export default async function TeamPage() {
  const user = await requirePageUser('admin')

  let data
  try {
    data = asJson(await listVisibleUsers(user))
  } catch (error) {
    console.error('Team page failed to load:', error)
    return <LoadError title="Team Management" what="the team" />
  }

  return <TeamPageClient initialUsers={data.users as User[]} />
}
