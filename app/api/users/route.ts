import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/api-auth'
import { globalUsersQuery } from '@/lib/contracts/users'
import { parseQuery } from '@/lib/contracts/progress'
import { listGlobalUsers } from '@/lib/server/global-users'
import { createGlobalAccount } from '@/lib/server/global-user-admin'

export async function GET(req: Request) {
  const { error } = await requirePlatformAdmin()
  if (error) return error
  const query = parseQuery(globalUsersQuery, new URL(req.url).searchParams)
  if (query.error !== undefined) return NextResponse.json({ error: query.error }, { status: 400 })
  return NextResponse.json(await listGlobalUsers(query.data))
}

export async function POST(req: Request) {
  const { user, error } = await requirePlatformAdmin()
  if (error) return error
  return createGlobalAccount(req, user)
}
