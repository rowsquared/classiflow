import { NextResponse } from 'next/server'
import { forbidden, notFound, requireSession } from '@/lib/api-auth'
import { getDirectoryUser, userDirectoryScope } from '@/lib/server/global-users'
import { accountDeletionBlocker } from '@/lib/server/accounts'

export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { user, error } = await requireSession()
  if (error) return error
  const scope = await userDirectoryScope(user)
  if (!scope.platform && !scope.workspaces.length) return forbidden()
  const account = await getDirectoryUser((await params).userId, scope)
  return account
    ? NextResponse.json({
        user: account,
        deletionBlocker: scope.platform ? await accountDeletionBlocker(account.id) : null
      })
    : notFound()
}
