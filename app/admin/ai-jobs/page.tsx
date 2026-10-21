import LoadError from '@/components/LoadError'
import { listAIJobs } from '@/lib/server/ai-jobs'
import { asJson } from '@/lib/server/json'
import { requirePageUser } from '@/lib/server/page-user'
import AIJobsClient, { type AIJob } from './AIJobsClient'

export default async function AIJobsPage() {
  await requirePageUser('admin')

  let data
  try {
    data = asJson(await listAIJobs({ statusParams: [], page: 1, limit: 20 }))
  } catch (error) {
    console.error('AI jobs page failed to load:', error)
    return <LoadError title="AI Jobs" what="the AI jobs" />
  }

  return <AIJobsClient initialJobs={data.jobs as AIJob[]} initialPagination={data.pagination} />
}
