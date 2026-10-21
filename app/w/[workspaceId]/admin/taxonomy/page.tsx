import LoadError from '@/components/LoadError'
import { asJson } from '@/lib/server/json'
import { requirePageUser } from '@/lib/server/page-user'
import { withWorkspace } from '@/lib/workspace/db'
import { listTaxonomiesWithStats } from '@/lib/server/taxonomies'
import TaxonomyAdminClient, { type Taxonomy } from './TaxonomyAdminClient'
import { logError } from '@/lib/logger'

export default async function TaxonomyAdminPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  await requirePageUser(workspaceId, 'admin')

  let data
  try {
    data = asJson(await withWorkspace(workspaceId, () => listTaxonomiesWithStats(workspaceId)))
  } catch (error) {
    await logError('Taxonomy page failed to load', error)
    return <LoadError title="Taxonomies" what="the taxonomies" />
  }

  return (
    <TaxonomyAdminClient
      initialTaxonomies={data.taxonomies as Taxonomy[]}
      initialLearningThreshold={data.learningThreshold}
    />
  )
}
