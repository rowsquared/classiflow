import LoadError from '@/components/LoadError'
import { listImports } from '@/lib/server/imports'
import { requirePageUser } from '@/lib/server/page-user'
import SentenceAdminClient from './SentenceAdminClient'

export default async function SentenceAdminPage() {
  await requirePageUser('admin')

  let data
  try {
    data = await listImports()
  } catch (error) {
    console.error('Record imports page failed to load:', error)
    return <LoadError title="Sentences" what="the record imports" />
  }

  return <SentenceAdminClient initialImports={data.imports} />
}
