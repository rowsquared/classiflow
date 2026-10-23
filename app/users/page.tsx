import { notFound, redirect } from 'next/navigation'
import GlobalShell from '@/components/GlobalShell'
import UsersClient from '@/components/users/UsersClient'
import { requirePageSession } from '@/lib/server/page-user'
import { userDirectoryScope, listDirectoryUsers } from '@/lib/server/global-users'
import { asJson } from '@/lib/server/json'
import { mailEnabled } from '@/lib/mail/config'
import { directoryQuery } from '@/lib/contracts/users'
import { loadUsersSearchParams } from '@/lib/users-url'
import LoadError from '@/components/LoadError'
import { logError } from '@/lib/logger'

export default async function UsersPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requirePageSession()
  const scope = await userDirectoryScope(user)
  if (!scope.platform && !scope.workspaces.length) notFound()
  const view = await loadUsersSearchParams(searchParams)
  if (!view.workspace && !scope.platform && scope.workspaces.length === 1) {
    const params = new URLSearchParams(
      Object.entries(view)
        .filter(([, value]) => value !== null && value !== '')
        .map(([key, value]) => [key, String(value)])
    )
    params.set('workspace', scope.workspaces[0]!.id)
    redirect(`/users?${params}`)
  }
  if (
    view.workspace === 'none' ? !scope.platform : view.workspace && !scope.workspaces.some(w => w.id === view.workspace)
  )
    notFound()
  const query = directoryQuery.safeParse(Object.fromEntries(Object.entries(view).filter(([, value]) => value !== null)))
  let initial
  try {
    if (query.success) initial = asJson(await listDirectoryUsers(query.data, scope))
  } catch (caught) {
    await logError('Could not load users page', caught)
  }
  return (
    <GlobalShell scopeKey={`${user.id}:${scope.platform}:${scope.workspaces.map(w => w.id).join(',')}`}>
      {initial ? (
        <UsersClient
          currentUserId={user.id}
          platform={scope.platform}
          workspaces={scope.workspaces}
          mailEnabled={mailEnabled()}
          initialData={initial}
          initialParams={JSON.stringify(view)}
        />
      ) : (
        <LoadError title="Users" what="the user directory (check the URL filters)" />
      )}
    </GlobalShell>
  )
}
