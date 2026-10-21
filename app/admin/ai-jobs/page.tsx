import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { serverFetchJSON } from '@/lib/server-fetch'
import AIJobsClient, { type AIJob } from './AIJobsClient'

export default async function AIJobsPage() {
  const session = await auth()
  if (!session?.user || session.user.role !== 'admin') {
    redirect('/queue')
  }

  const data = await serverFetchJSON<{
    jobs: AIJob[]
    pagination: { page: number; limit: number; total: number; pages: number }
  }>('/api/ai-jobs?page=1&limit=20')

  return (
    <AIJobsClient
      initialJobs={data?.jobs ?? []}
      initialPagination={data?.pagination ?? { page: 1, limit: 20, total: 0, pages: 0 }}
    />
  )
}

