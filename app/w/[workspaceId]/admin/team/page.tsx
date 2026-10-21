import LoadError from '@/components/LoadError'
import { asJson } from '@/lib/server/json'
import { requirePageUser } from '@/lib/server/page-user'
import { withWorkspace } from '@/lib/workspace/db'
import { listVisibleUsers } from '@/lib/server/users'
import { listInvitations } from '@/lib/server/invitations'
import { mailEnabled } from '@/lib/mail/config'
import { recoverOutbox } from '@/lib/mail/outbox'
import TeamPageClient, { type PendingInvitation, type User } from './TeamPageClient'
import { logError } from '@/lib/logger'

export default async function TeamPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await requirePageUser(workspaceId, 'admin')

  let loaded
  try {
    await recoverOutbox().catch(error => logError('Mail outbox recovery failed', error))
    loaded = asJson(
      await withWorkspace(workspaceId, async () => ({
        users: (await listVisibleUsers(user, { includeSuspended: true })).users,
        invitations: await listInvitations(workspaceId)
      }))
    )
  } catch (error) {
    await logError('Team page failed to load', error)
    return <LoadError title="Team Management" what="the team" />
  }

  return (
    <TeamPageClient
      initialUsers={loaded.users as User[]}
      initialInvitations={loaded.invitations as PendingInvitation[]}
      mailEnabled={mailEnabled()}
    />
  )
}
