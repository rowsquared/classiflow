import { NextResponse } from 'next/server'
import { requirePlatformAdmin, notFound } from '@/lib/api-auth'
import { sendAdminPasswordLink } from '@/lib/server/accounts'

export async function POST(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { user, error } = await requirePlatformAdmin()
  if (error) return error
  const result = await sendAdminPasswordLink((await params).userId, user.id)
  if (!result) return notFound()
  return NextResponse.json(result, { status: result.ok ? 200 : 409 })
}
