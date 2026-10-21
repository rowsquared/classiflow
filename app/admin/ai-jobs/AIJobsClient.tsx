'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import PageHeader from '@/components/PageHeader'
import { formatRelativeTime } from '@/lib/utils'
import { CheckCircle2, XCircle, Clock, Loader2, AlertCircle } from 'lucide-react'
import Modal from '@/components/Modal'

export type AIJob = {
  id: string
  type: 'labeling' | 'learning' | 'taxonomy_sync' | 'external_training'
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  taxonomy: string
  totalSentences?: number
  processedSentences?: number
  failedSentences?: number
  recordCount?: number
  fileName?: string
  startedAt: string
  completedAt: string | null
  errorMessage: string | null
  createdBy: {
    id: string
    name: string | null
    email: string
  } | null
}

type Pagination = {
  page: number
  limit: number
  total: number
  pages: number
}

type Props = {
  initialJobs: AIJob[]
  initialPagination: Pagination
}

export default function AIJobsClient({ initialJobs, initialPagination }: Props) {
  const [jobs, setJobs] = useState<AIJob[]>(initialJobs)
  const [pagination, setPagination] = useState<Pagination>(initialPagination)
  const [loading, setLoading] = useState(false)
  const [selectedJob, setSelectedJob] = useState<AIJob | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const skipInitialFetch = useRef(true)

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20'
      })
      if (statusFilter !== 'all') {
        params.append('status', statusFilter)
      }

      const res = await fetch(`/api/ai-jobs?${params}`)
      if (res.ok) {
        const data = await res.json()
        setJobs(data.jobs || [])
        setPagination(data.pagination || initialPagination)
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, initialPagination])

  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false
      return
    }
    fetchJobs()
  }, [fetchJobs])

  // Poll for active jobs if any are pending/processing
  useEffect(() => {
    const hasActiveJobs = jobs.some(j => j.status === 'pending' || j.status === 'processing')
    if (!hasActiveJobs) return

    const interval = setInterval(() => {
      fetchJobs()
    }, 5000) // Poll every 5 seconds

    return () => clearInterval(interval)
  }, [jobs, fetchJobs])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'processing':
        return <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
      case 'cancelled':
        return <AlertCircle className="w-4 h-4 text-gray-500" />
      default:
        return <Clock className="w-4 h-4 text-gray-500" />
    }
  }

  const getStatusBadge = (status: string) => {
    const baseClasses = 'px-2 py-1 rounded text-xs font-medium capitalize'
    switch (status) {
      case 'completed':
        return `${baseClasses} bg-green-100 text-green-800`
      case 'failed':
        return `${baseClasses} bg-red-100 text-red-800`
      case 'processing':
        return `${baseClasses} bg-indigo-100 text-indigo-800`
      case 'cancelled':
        return `${baseClasses} bg-gray-100 text-gray-800`
      default:
        return `${baseClasses} bg-yellow-100 text-yellow-800`
    }
  }

  const getProgress = (job: AIJob) => {
    if (job.type === 'external_training' || job.type === 'learning' || job.type === 'taxonomy_sync') {
      // These jobs don't have detailed progress tracking
      if (job.status === 'completed') return 100
      if (job.status === 'processing') return 50
      if (job.status === 'failed' || job.status === 'cancelled') return 0
      return 0 // pending
    }
    if (!job.totalSentences || job.totalSentences === 0) return 0
    return Math.round((job.processedSentences || 0) / job.totalSentences * 100)
  }

  const getJobTypeLabel = (type: string) => {
    switch (type) {
      case 'labeling':
        return 'Labeling'
      case 'learning':
        return 'Learning'
      case 'taxonomy_sync':
        return 'Taxonomy Sync'
      case 'external_training':
        return 'External Training'
      default:
        return 'AI Job'
    }
  }

  const handleJobClick = (job: AIJob) => {
    setSelectedJob(job)
    setShowDetailModal(true)
  }

  const handleCancelJob = async (job: AIJob, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent row click
    
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return // Can't cancel completed/failed/cancelled jobs
    }
    
    if (!confirm(`Are you sure you want to cancel this ${getJobTypeLabel(job.type).toLowerCase()} job?`)) {
      return
    }
    
    try {
      const res = await fetch(`/api/ai-jobs/${job.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: job.type })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to cancel job')
      }
      
      // Refresh jobs list
      await fetchJobs()
    } catch (error) {
      console.error('Failed to cancel AI job:', error)
      alert(error instanceof Error ? error.message : 'Failed to cancel job')
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <PageHeader title="AI Jobs" />
      
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* Filters */}
        <div className="mb-6 flex items-center gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setPage(1)
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Jobs Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {loading && jobs.length === 0 ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : jobs.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No jobs found</div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Taxonomy</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Progress</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created By</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Completed</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {jobs.map(job => {
                  const progress = getProgress(job)
                  return (
                    <tr
                      key={job.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleJobClick(job)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(job.status)}
                          <span className={getStatusBadge(job.status)}>
                            {job.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                          {getJobTypeLabel(job.type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {job.taxonomy}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-[120px]">
                          <div className="flex-1 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-600 whitespace-nowrap">{progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {job.type === 'external_training' ? (
                          <div>
                            <div>{job.recordCount || 0} records</div>
                            {job.fileName && (
                              <div className="text-xs text-gray-500 truncate max-w-[200px]" title={job.fileName}>
                                {job.fileName}
                              </div>
                            )}
                          </div>
                        ) : job.type === 'learning' || job.type === 'taxonomy_sync' ? (
                          <span className="text-gray-500">-</span>
                        ) : (
                          <>
                            {job.processedSentences || 0} / {job.totalSentences || 0}
                            {(job.failedSentences || 0) > 0 && (
                              <span className="text-red-600 ml-1">({job.failedSentences} failed)</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {job.createdBy ? (job.createdBy.name || job.createdBy.email) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {formatRelativeTime(job.startedAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {job.completedAt ? formatRelativeTime(job.completedAt) : '-'}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {(job.status === 'pending' || job.status === 'processing') && (
                          <button
                            onClick={(e) => handleCancelJob(job, e)}
                            className="px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} jobs
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {pagination.page} of {pagination.pages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                disabled={page === pagination.pages}
                className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Job Detail Modal */}
      {showDetailModal && selectedJob && (
        <Modal label="Job details" onClose={() => setShowDetailModal(false)} className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50" closeOnOverlayClick>
          <div
            className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Job Details</h2>
              <button
                onClick={() => setShowDetailModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Job ID</label>
                <p className="text-sm text-gray-900 font-mono">{selectedJob.id}</p>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">Status</label>
                <div className="flex items-center gap-2 mt-1">
                  {getStatusIcon(selectedJob.status)}
                  <span className={getStatusBadge(selectedJob.status)}>
                    {selectedJob.status}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">Type</label>
                <p className="text-sm text-gray-900">{getJobTypeLabel(selectedJob.type)}</p>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">Taxonomy</label>
                <p className="text-sm text-gray-900">{selectedJob.taxonomy}</p>
              </div>

              {selectedJob.type === 'labeling' && (
                <>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Progress</label>
                    <div className="mt-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex-1 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${getProgress(selectedJob)}%` }}
                          />
                        </div>
                        <span className="text-sm text-gray-600">{getProgress(selectedJob)}%</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        {selectedJob.processedSentences || 0} / {selectedJob.totalSentences || 0} sentences processed
                        {(selectedJob.failedSentences || 0) > 0 && (
                          <span className="text-red-600 ml-1">({selectedJob.failedSentences} failed)</span>
                        )}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {selectedJob.type === 'external_training' && (
                <div>
                  <label className="text-sm font-medium text-gray-700">Training Data</label>
                  <p className="text-sm text-gray-900">{selectedJob.recordCount || 0} records</p>
                  {selectedJob.fileName && (
                    <p className="text-sm text-gray-600 mt-1">File: {selectedJob.fileName}</p>
                  )}
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-gray-700">Created By</label>
                <p className="text-sm text-gray-900">{selectedJob.createdBy ? (selectedJob.createdBy.name || selectedJob.createdBy.email) : '-'}</p>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">Started</label>
                <p className="text-sm text-gray-900">{new Date(selectedJob.startedAt).toLocaleString()}</p>
              </div>

              {selectedJob.completedAt && (
                <div>
                  <label className="text-sm font-medium text-gray-700">Completed</label>
                  <p className="text-sm text-gray-900">{new Date(selectedJob.completedAt).toLocaleString()}</p>
                </div>
              )}

              {selectedJob.errorMessage && (
                <div>
                  <label className="text-sm font-medium text-gray-700">Error</label>
                  <p className="text-sm text-red-600 bg-red-50 p-3 rounded mt-1">{selectedJob.errorMessage}</p>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

