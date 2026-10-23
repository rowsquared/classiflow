import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePlatformAdmin } from '@/lib/api-auth'
import { lookupGlobalAccount } from '@/lib/server/global-users'

export async function GET(req: Request) {
  const { error } = await requirePlatformAdmin()
  if (error) return error
  const email = z.string().trim().email().max(254).safeParse(new URL(req.url).searchParams.get('email'))
  if (!email.success) return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 })
  return NextResponse.json({ user: await lookupGlobalAccount(email.data) })
}
