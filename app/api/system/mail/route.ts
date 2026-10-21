import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/api-auth'
import { mailStatus } from '@/lib/mail/config'
import { recoverOutbox } from '@/lib/mail/outbox'

// Whether outgoing email is configured, for platform admins. No secrets.
export async function GET() {
  const { error } = await requirePlatformAdmin()
  if (error) return error
  await recoverOutbox()
  return NextResponse.json(mailStatus())
}
