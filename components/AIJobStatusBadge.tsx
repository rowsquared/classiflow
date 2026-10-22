'use client'
import { useWorkspacePaths, workspaceApi } from '@/lib/workspace/urls'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceInfo } from '@/components/WorkspaceProvider'
import { fetchJson } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { Loader2, CheckCircle2, XCircle, Clock, X } from 'lucide-react'
import Link from 'next/link'

type AIJob = {
  id: string
  type: 'labeling' | 'learning' | 'taxonomy_sync'
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  taxonomy: string
  totalSentences?: number
  processedSentences?: number
  failedSentences?: number
  startedAt: string
  completedAt?: string | null
  errorMessage?: string | null
  createdBy?: {
    id: string
    name: string | null
    email: string
  }
}

const isActiveJob = (job: AIJob) => job.status === 'pending' || job.status === 'processing'

export default function AIJobStatusBadge() {
  const workspace = useWorkspaceInfo()
  const { href } = useWorkspacePaths()
  const queryClient = useQueryClient()
  const [showDropdown, setShowDropdown] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Admins of the current workspace only; nothing outside a workspace.
  const isAdmin = workspace?.role === 'admin'
  const workspaceId = workspace?.id ?? ''

  // Active and recently finished jobs, every 3 s while the tab is visible
  // (refetchInterval pauses in hidden tabs; returning to the tab refetches).
  const { data: jobs = [] } = useQuery({
    queryKey: queryKeys.aiJobsActive(workspaceId),
    queryFn: async ({ signal }) => {
      const data = await fetchJson<{ ok?: boolean; jobs?: AIJob[] }>(workspaceApi('/ai-jobs/active'), { signal })
      return data.ok && data.jobs ? data.jobs : []
    },
    enabled: isAdmin,
    staleTime: 0,
    refetchInterval: 3000
  })

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showDropdown) return
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDropdown])

  // Don't render for non-admins or when there are no jobs at all
  if (!isAdmin) return null
  if (jobs.length === 0) return null

  const activeCount = jobs.filter(isActiveJob).length
  // Active jobs first, then the most recent.
  const sortedJobs = [...jobs].sort((a, b) => {
    const aActive = isActiveJob(a) ? 0 : 1
    const bActive = isActiveJob(b) ? 0 : 1
    if (aActive !== bActive) return aActive - bActive
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  })

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" aria-hidden="true" />
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" aria-hidden="true" />
      case 'processing':
        return <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" aria-hidden="true" />
      default:
        return <Clock className="w-4 h-4 text-gray-500" aria-hidden="true" />
    }
  }

  const getProgress = (job: AIJob) => {
    if (job.status === 'completed') return 100
    if (job.type === 'taxonomy_sync') {
      return job.status === 'processing' ? 50 : 0
    }
    if (!job.totalSentences || job.totalSentences === 0) return 0
    return Math.round(((job.processedSentences || 0) / job.totalSentences) * 100)
  }

  const getJobTypeLabel = (job: AIJob) => {
    switch (job.type) {
      case 'labeling':
        return 'Labeling'
      case 'learning':
        return 'Learning'
      case 'taxonomy_sync':
        return 'Taxonomy sync'
      default:
        return 'AI Job'
    }
  }

  const handleCancelJob = async (job: AIJob) => {
    if (!isActiveJob(job)) return
    setCancelError(null)
    try {
      await fetchJson(workspaceApi(`/ai-jobs/${job.id}/cancel`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: job.type })
      })
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : 'Failed to cancel job')
    } finally {
      // The badge, the AI jobs page and the taxonomy statuses all show this job.
      void queryClient.invalidateQueries({ queryKey: queryKeys.aiJobs(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.taxonomies(workspaceId) })
    }
  }

  const shownCount = activeCount > 0 ? activeCount : jobs.length

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        aria-expanded={showDropdown}
        className="relative flex items-center gap-2 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors"
      >
        {activeCount > 0 ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-green-500" aria-hidden="true" />
        )}
        <span className="font-medium">{shownCount}</span>
        <span className="text-sm">AI job{shownCount !== 1 ? 's' : ''}</span>
      </button>

      {showDropdown && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-y-auto">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{activeCount > 0 ? 'Active AI Jobs' : 'Recent AI Jobs'}</h3>
              <Link
                href={href('/admin/ai-jobs')}
                className="text-sm text-indigo-600 hover:text-indigo-700"
                onClick={() => setShowDropdown(false)}
              >
                View all
              </Link>
            </div>
            {cancelError && (
              <p role="alert" className="mt-2 text-xs text-red-700">
                {cancelError}
              </p>
            )}
          </div>
          <div className="p-2">
            <div className="space-y-2">
              {sortedJobs.map(job => {
                const progress = getProgress(job)
                const isFinished = job.status === 'completed' || job.status === 'failed'
                const isActive = isActiveJob(job)

                return (
                  <div
                    key={job.id}
                    className={`p-3 rounded-lg border transition-colors ${
                      isFinished ? 'border-gray-200 opacity-75' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {getStatusIcon(job.status)}
                          <span className="font-medium text-sm text-gray-900 truncate">
                            {getJobTypeLabel(job)}: {job.taxonomy}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600">
                          {job.type === 'learning' || job.type === 'taxonomy_sync' ? (
                            job.status === 'failed' ? (
                              job.errorMessage || 'Failed'
                            ) : (
                              'Processing...'
                            )
                          ) : (
                            <>
                              {job.processedSentences || 0} / {job.totalSentences || 0} sentences
                              {(job.failedSentences || 0) > 0 && (
                                <span className="text-red-700 ml-1">({job.failedSentences} failed)</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isActive && (
                          <span className="text-xs text-gray-600 whitespace-nowrap font-medium">{progress}%</span>
                        )}
                        {isFinished && (
                          <span
                            className={`text-xs whitespace-nowrap ${
                              job.status === 'completed' ? 'text-green-700' : 'text-red-700'
                            }`}
                          >
                            {job.status === 'completed' ? 'Done' : 'Failed'}
                          </span>
                        )}
                        {isActive && (
                          <button
                            onClick={() => handleCancelJob(job)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-red-700 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                            title="Cancel job"
                          >
                            <X className="w-3 h-3" aria-hidden="true" />
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 h-1.5">
                      <div
                        className={`h-1.5 transition-all duration-300 ${
                          isFinished ? (job.status === 'completed' ? 'bg-green-500' : 'bg-red-500') : 'bg-indigo-500'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
