import LoadError from '@/components/LoadError'
import { asJson } from '@/lib/server/json'
import { requirePageUser } from '@/lib/server/page-user'
import { listTaxonomiesWithStats } from '@/lib/server/taxonomies'
import TaxonomyAdminClient, { type Taxonomy } from './TaxonomyAdminClient'

export default async function TaxonomyAdminPage() {
  await requirePageUser('admin')

  let data
  try {
    data = asJson(await listTaxonomiesWithStats())
  } catch (error) {
    console.error('Taxonomy page failed to load:', error)
    return <LoadError title="Taxonomies" what="the taxonomies" />
  }

  return (
    <TaxonomyAdminClient
      initialTaxonomies={data.taxonomies as Taxonomy[]}
      initialLearningThreshold={data.learningThreshold}
    />
  )
}
