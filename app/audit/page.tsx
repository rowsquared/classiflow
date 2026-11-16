import { notFound } from 'next/navigation'
import AuditLogClient from '@/components/AuditLogClient'
import GlobalShell from '@/components/GlobalShell'
import { requirePageSession } from '@/lib/server/page-user'

export default async function PlatformAuditPage() {
  const user = await requirePageSession()
  if (user.platformRole !== 'admin') notFound()
  return (
    <GlobalShell user={user} scopeKey={`${user.id}:${user.platformRole}`}>
      <AuditLogClient platform />
    </GlobalShell>
  )
}
