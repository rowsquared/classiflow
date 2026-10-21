import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import SentenceAdminClient, { type SentenceImport } from './SentenceAdminClient'
import { serverFetchJSON } from '@/lib/server-fetch'

export default async function SentenceAdminPage() {
  const session = await auth()
  if (!session?.user || session.user.role !== 'admin') {
    redirect('/queue')
  }

  const importsData = await serverFetchJSON<{ ok: boolean; imports: SentenceImport[] }>('/api/imports')
  const initialImports = importsData?.imports ?? []
  return <SentenceAdminClient initialImports={initialImports} />
}

