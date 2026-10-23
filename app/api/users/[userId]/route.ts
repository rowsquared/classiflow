import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/api-auth'
import { getGlobalUser } from '@/lib/server/global-users'
import { updateGlobalAccount, deleteGlobalAccount } from '@/lib/server/global-user-admin'

type Params = { params: Promise<{ userId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { error } = await requirePlatformAdmin()
  if (error) return error
  const user = await getGlobalUser((await params).userId)
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  return NextResponse.json({ user })
}

export async function PUT(req: Request, { params }: Params) {
  const { user, error } = await requirePlatformAdmin()
  if (error) return error
  return updateGlobalAccount(req, user, (await params).userId)
}

export async function DELETE(_req: Request, { params }: Params) {
  const { user, error } = await requirePlatformAdmin()
  if (error) return error
  return deleteGlobalAccount(user, (await params).userId)
}
