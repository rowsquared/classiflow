import GlobalShell from '@/components/GlobalShell'
import { requirePageSession } from '@/lib/server/page-user'
import { workspaceManagementSummaries } from '@/lib/server/workspaces'
import WorkspacesClient from './WorkspacesClient'
import LoadError from '@/components/LoadError'
import { logError } from '@/lib/logger'
import { asJson } from '@/lib/server/json'
export default async function WorkspacesPage() {
  const user = await requirePageSession()
  let workspaces
  try {
    workspaces = asJson(await workspaceManagementSummaries(user))
  } catch (caught) {
    await logError('Could not load workspace directory', caught)
  }
  return (
    <GlobalShell scopeKey={`${user.id}:${user.platformRole}`}>
      {workspaces ? (
        <WorkspacesClient workspaces={workspaces} platform={user.platformRole === 'admin'} />
      ) : (
        <LoadError title="Workspaces" what="workspaces" />
      )}
    </GlobalShell>
  )
}
