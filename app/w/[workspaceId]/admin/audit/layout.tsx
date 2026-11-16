import type { ReactNode } from 'react'
import { requirePageUser } from '@/lib/server/page-user'

export default async function AuditLayout({
  children,
  params
}: {
  children: ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  await requirePageUser((await params).workspaceId, 'admin')
  return children
}
