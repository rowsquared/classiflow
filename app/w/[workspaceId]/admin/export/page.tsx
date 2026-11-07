import { requirePageUser } from '@/lib/server/page-user'
import ExportPageClient from './ExportPageClient'

/** Export: admins (records and analysis) and supervisors (their team's double annotation analysis). */
export default async function ExportPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await requirePageUser(workspaceId, 'admin', 'supervisor')
  return <ExportPageClient role={user.role === 'admin' ? 'admin' : 'supervisor'} />
}
