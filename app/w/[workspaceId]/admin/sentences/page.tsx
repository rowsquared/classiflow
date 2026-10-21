import LoadError from '@/components/LoadError'
import { listImports } from '@/lib/server/imports'
import { requirePageUser } from '@/lib/server/page-user'
import { withWorkspace } from '@/lib/workspace/db'
import SentenceAdminClient from './SentenceAdminClient'

export default async function SentenceAdminPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  await requirePageUser(workspaceId, 'admin')

  let data
  try {
    data = await withWorkspace(workspaceId, () => listImports(workspaceId))
  } catch (error) {
    console.error('Record imports page failed to load:', error)
    return <LoadError title="Sentences" what="the record imports" />
  }

  return <SentenceAdminClient initialImports={data.imports} />
}
