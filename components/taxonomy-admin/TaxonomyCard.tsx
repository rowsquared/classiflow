'use client'

import { useMutation } from '@tanstack/react-query'
import { formatDate, formatRelativeTime } from '@/lib/utils'
import { workspaceApi } from '@/lib/workspace/urls'
import { fetchJson } from '@/lib/query/fetch'
import type { Message, Taxonomy } from './types'
import { buttonClass, panelClass } from '@/components/ui/styles'

type Props = {
  taxonomy: Taxonomy
  learningThreshold: number
  onEdit: (taxonomy: Taxonomy) => void
  onDelete: (taxonomy: Taxonomy) => void
  /** A result line for the page. */
  onMessage: (message: Message | null) => void
  /** A sync or learning job was queued: refresh the list and the job views. */
  onJobStarted: () => void
}

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null
  const normalized = status.toLowerCase()
  const styles =
    normalized === 'success' || normalized === 'completed' || normalized === 'deleted'
      ? 'bg-green-100 text-green-800'
      : normalized === 'processing'
        ? 'bg-indigo-100 text-indigo-800'
        : normalized === 'pending' || normalized === 'deleting'
          ? 'bg-yellow-100 text-yellow-800'
          : normalized === 'failed' || normalized === 'delete_failed'
            ? 'bg-red-100 text-red-800'
            : 'bg-gray-100 text-gray-800'
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles}`}>{status.replaceAll('_', ' ')}</span>
}

/** One taxonomy: its size, edit/delete, and the AI sync and learning actions. */
export default function TaxonomyCard({
  taxonomy,
  learningThreshold,
  onEdit,
  onDelete,
  onMessage,
  onJobStarted
}: Props) {
  const synced = taxonomy.lastAISyncStatus === 'completed'
  const startJob = useMutation({
    mutationFn: ({ path, init }: { path: string; init: RequestInit }) =>
      fetchJson<{ totalJobs?: number; totalSentences?: number }>(workspaceApi(path), init),
    onMutate: () => onMessage(null),
    onError: error => onMessage({ type: 'error', text: error.message }),
    onSuccess: (data, { path }) => {
      onMessage({
        type: 'success',
        text:
          path === '/ai-labeling/learn'
            ? `Queued ${data.totalJobs} learning jobs for ${data.totalSentences} records.`
            : `AI sync queued for "${taxonomy.key}".`
      })
      onJobStarted()
    }
  })
  const learning = startJob.isPending && startJob.variables?.path === '/ai-labeling/learn'
  const syncing = startJob.isPending && !learning

  const handleSyncAI = () => startJob.mutate({ path: `/taxonomies/${taxonomy.key}/sync-ai`, init: { method: 'POST' } })

  const handleLearning = () =>
    startJob.mutate({
      path: '/ai-labeling/learn',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxonomyKey: taxonomy.key })
      }
    })

  return (
    <div className={`${panelClass} overflow-hidden`} data-testid="taxonomy-card">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-4 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900">{taxonomy.key}</h2>
              <span className="text-sm text-gray-600">{(taxonomy.nodeCount ?? 0).toLocaleString()} nodes</span>
              <span className="text-sm text-gray-600">{taxonomy.actualMaxLevel ?? 0} levels</span>
              <span className="text-sm text-gray-600">Created {formatDate(taxonomy.createdAt)}</span>
            </div>
            {taxonomy.description && <p className="text-sm text-gray-600 mt-1">{taxonomy.description}</p>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(taxonomy)}
              className="px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50 rounded-md transition-colors font-medium"
            >
              Edit
            </button>
            <button
              onClick={() => onDelete(taxonomy)}
              className="px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 rounded-md transition-colors font-medium"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="flex gap-4 flex-wrap">
          <div className="flex flex-col">
            <button onClick={handleSyncAI} disabled={startJob.isPending} className={buttonClass('primary')}>
              {syncing ? 'Syncing…' : 'Sync taxonomy with AI'}
            </button>
            <div className="mt-2 text-center">
              <StatusBadge status={taxonomy.lastAISyncStatus} />
              <p className="text-xs text-gray-600 mt-1">
                {taxonomy.lastAISyncAt ? formatRelativeTime(taxonomy.lastAISyncAt) : 'Never synced'}
              </p>
            </div>
          </div>

          <div className="flex flex-col">
            <button
              onClick={handleLearning}
              disabled={
                !synced ||
                startJob.isPending ||
                taxonomy.lastLearningStatus === 'processing' ||
                (!taxonomy.learningBacklog &&
                  taxonomy.lastLearningStatus !== 'failed' &&
                  taxonomy.newAnnotationsSinceLastLearning < learningThreshold)
              }
              className={buttonClass('primary')}
            >
              {learning
                ? 'Sending…'
                : taxonomy.learningBacklog
                  ? 'Continue training'
                  : 'Train AI with submitted labels'}
            </button>
            <div className="mt-2 text-center">
              <StatusBadge status={taxonomy.lastLearningStatus} />
              <p className="text-xs text-gray-600 mt-1">
                {taxonomy.lastLearningAt ? formatRelativeTime(taxonomy.lastLearningAt) : 'Never trained'}{' '}
                <strong>{(taxonomy.newAnnotationsSinceLastLearning ?? 0).toLocaleString()}</strong> /{' '}
                {learningThreshold.toLocaleString()} new annotations
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
