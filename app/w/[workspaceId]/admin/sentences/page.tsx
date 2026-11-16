import { listImports } from '@/lib/server/imports'
import { requirePageUser } from '@/lib/server/page-user'
import { withWorkspace } from '@/lib/workspace/db'
import SentenceAdminClient from './SentenceAdminClient'
import { logError } from '@/lib/logger'

export default async function SentenceAdminPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await requirePageUser(workspaceId, 'admin')

  let data
  try {
    data = await withWorkspace(workspaceId, () => listImports(user))
  } catch (error) {
    await logError('Record imports page failed to load', error)
  }

  return <SentenceAdminClient initialImports={data?.imports} />
}
