import { redirect } from 'next/navigation'
import LoadError from '@/components/LoadError'
import { logError } from '@/lib/logger'
import { loadQueueUrlState, serializeQueueUrlState } from '@/lib/queue-url'
import { getQueueAIOptions } from '@/lib/server/ai-queue'
import { requirePageUser } from '@/lib/server/page-user'
import { withWorkspace } from '@/lib/workspace/db'
import SendToAIClient from './SendToAIClient'

export default async function SendToAIPage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { workspaceId } = await params
  const user = await requirePageUser(workspaceId, 'admin')
  if (user.archived) redirect(`/w/${workspaceId}/queue`)
  const queue = serializeQueueUrlState(await loadQueueUrlState(await searchParams))
  let options
  try {
    options = await withWorkspace(workspaceId, getQueueAIOptions)
  } catch (error) {
    await logError('Could not load AI queue options', error)
    return <LoadError title="Send to AI" what="the AI options" />
  }
  return <SendToAIClient key={queue} queue={queue} {...options} />
}
