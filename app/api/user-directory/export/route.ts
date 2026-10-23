import { NextResponse } from 'next/server'
import { requireSession, forbidden, notFound } from '@/lib/api-auth'
import { directoryQuery } from '@/lib/contracts/users'
import { parseQuery } from '@/lib/contracts/progress'
import { userDirectoryScope, listDirectoryUsers } from '@/lib/server/global-users'
import { toCsv } from '@/lib/csv'
import { logError } from '@/lib/logger'

/** Filtered directory, all pages. Membership exports remain the complete selected workspace. */
export async function GET(req: Request) {
  const { user, error } = await requireSession()
  if (error) return error
  const scope = await userDirectoryScope(user)
  if (!scope.platform && !scope.workspaces.length) return forbidden()
  const parsed = parseQuery(directoryQuery, new URL(req.url).searchParams)
  if (parsed.error !== undefined) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (
    parsed.data.workspace === 'none'
      ? !scope.platform
      : parsed.data.workspace && !scope.workspaces.some(w => w.id === parsed.data.workspace)
  )
    return notFound()
  try {
    const rows: string[][] = []
    for (let page = 1; ; page++) {
      const result = await listDirectoryUsers({ ...parsed.data, page, pageSize: 100 }, scope)
      rows.push(
        ...result.users.map(u => [
          u.name,
          u.email,
          u.username,
          u.banned ? 'disabled' : 'enabled',
          u.lastLogin?.toISOString() ?? '',
          u.memberships
            .filter(m => m.status === 'active')
            .map(m => `${m.workspace.name}: ${m.role}`)
            .join('; ')
        ])
      )
      if (page * 100 >= result.total) break
    }
    const columns = ['name', 'email', 'sign_in_alias', 'account_state', 'last_sign_in', 'workspace_access'].map(
      header => ({ header, text: true })
    )
    return new Response(toCsv(columns, rows, { neutralizeFormulas: true }), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="users.csv"',
        'Cache-Control': 'no-store'
      }
    })
  } catch (caught) {
    await logError('Could not export users', caught)
    return NextResponse.json({ error: 'Could not export users' }, { status: 500 })
  }
}
