import { NextResponse } from 'next/server'
import { forbidden, requireSession, notFound } from '@/lib/api-auth'
import { directoryQuery } from '@/lib/contracts/users'
import { parseQuery } from '@/lib/contracts/progress'
import { listDirectoryUsers, userDirectoryScope } from '@/lib/server/global-users'
import { logError } from '@/lib/logger'

export async function GET(req: Request) {
  const { user, error } = await requireSession()
  if (error) return error
  const scope = await userDirectoryScope(user)
  if (!scope.platform && scope.workspaces.length === 0) return forbidden()
  const query = parseQuery(directoryQuery, new URL(req.url).searchParams)
  if (query.error !== undefined) return NextResponse.json({ error: query.error }, { status: 400 })
  if (
    query.data.workspace === 'none'
      ? !scope.platform
      : query.data.workspace && !scope.workspaces.some(w => w.id === query.data.workspace)
  )
    return notFound()
  try {
    return NextResponse.json(await listDirectoryUsers(query.data, scope))
  } catch (caught) {
    await logError('Could not load user directory', caught)
    return NextResponse.json({ error: 'Could not load users' }, { status: 500 })
  }
}
