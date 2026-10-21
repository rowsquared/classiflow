'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { Loader2, CheckCircle2, XCircle, Clock, X } from 'lucide-react'
import Link from 'next/link'

type AIJob = {
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
  completedAt?: string | null
  errorMessage?: string | null
  createdBy?: {
    id: string
    name: string | null
    email: string
  }
}

export default function AIJobStatusBadge() {
  const { data: session } = useSession()
  const [jobs, setJobs] = useState<AIJob[]>([])
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const isAdmin = session?.user && session.user.role === 'admin'

  // Poll for jobs (active + recently finished)
  useEffect(() => {
    if (!isAdmin) return

    const fetchJobs = async () => {
      try {
        const res = await fetch('/api/ai-jobs/active')
        if (res.ok) {
          const data = await res.json()
          if (data.ok && data.jobs) {
            setJobs(prev => {
              const next = data.jobs as AIJob[]
              // Only update if data actually changed
              if (prev.length !== next.length) return next
              const changed = prev.some((pJob, i) => {
                const nJob = next[i]
                if (!nJob) return true
                return pJob.id !== nJob.id ||
                  pJob.status !== nJob.status ||
                  (pJob.processedSentences ?? 0) !== (nJob.processedSentences ?? 0) ||
                  (pJob.failedSentences ?? 0) !== (nJob.failedSentences ?? 0)
              })
              return changed ? next : prev
            })
          } else {
            setJobs(prev => prev.length > 0 ? [] : prev)
          }
        } else if (res.status === 401) {
          setJobs([])
        }
      } catch (err) {
        if (err instanceof TypeError && err.message === 'Failed to fetch') {
          setJobs([])
        } else {
          console.error('Failed to fetch active jobs:', err)
        }
      } finally {
        if (isInitialLoad) {
          setIsInitialLoad(false)
        }
      }
    }

    fetchJobs()
    const interval = setInterval(fetchJobs, 3000)
    return () => clearInterval(interval)
  }, [isAdmin, isInitialLoad])

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

  // Derived data
  const activeCount = useMemo(
    () => jobs.filter(j => j.status === 'pending' || j.status === 'processing').length,
    [jobs]
  )

  const sortedJobs = useMemo(() => {
    if (jobs.length === 0) return []
    return [...jobs].sort((a, b) => {
      // Active jobs first, then recent
      const aActive = a.status === 'pending' || a.status === 'processing' ? 0 : 1
      const bActive = b.status === 'pending' || b.status === 'processing' ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    })
  }, [jobs])

  // Don't render for non-admins or when there are no jobs at all
  if (!isAdmin) return null
  if (jobs.length === 0) return null

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case 'failed': return <XCircle className="w-4 h-4 text-red-500" />
      case 'processing': return <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
      default: return <Clock className="w-4 h-4 text-gray-500" />
    }
  }

  const getProgress = (job: AIJob) => {
    if (job.status === 'completed') return 100
    if (job.type === 'external_training' || job.type === 'taxonomy_sync') {
      return job.status === 'processing' ? 50 : 0
    }
    if (!job.totalSentences || job.totalSentences === 0) return 0
    return Math.round((job.processedSentences || 0) / job.totalSentences * 100)
  }

  const getJobTypeLabel = (job: AIJob) => {
    switch (job.type) {
      case 'labeling': return 'Labeling'
      case 'learning': return 'Learning'
      case 'taxonomy_sync': return 'Taxonomy Sync'
      case 'external_training': return 'External Training'
      default: return 'AI Job'
    }
  }

  const handleCancelJob = async (job: AIJob) => {
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return
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
      // Refresh immediately
      const activeRes = await fetch('/api/ai-jobs/active')
      if (activeRes.ok) {
        const activeData = await activeRes.json()
        if (activeData.ok) setJobs(activeData.jobs || [])
      }
    } catch (error) {
      console.error('Failed to cancel AI job:', error)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative flex items-center gap-2 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors"
      >
        {activeCount > 0 ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        )}
        <span className="font-medium">{activeCount > 0 ? activeCount : jobs.length}</span>
        <span className="text-sm">AI job{(activeCount > 0 ? activeCount : jobs.length) !== 1 ? 's' : ''}</span>
      </button>

      {showDropdown && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-y-auto">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                {activeCount > 0 ? 'Active AI Jobs' : 'Recent AI Jobs'}
              </h3>
              <Link
                href="/admin/ai-jobs"
                className="text-sm text-indigo-600 hover:text-indigo-700"
                onClick={() => setShowDropdown(false)}
              >
                View all
              </Link>
            </div>
          </div>
          <div className="p-2">
            {sortedJobs.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">No active jobs</div>
            ) : (
              <div className="space-y-2">
                {sortedJobs.map((job) => {
                  const progress = getProgress(job)
                  const isFinished = job.status === 'completed' || job.status === 'failed'
                  const isActive = job.status === 'pending' || job.status === 'processing'

                  return (
                    <div
                      key={job.id}
                      className={`p-3 rounded-lg border transition-colors ${
                        isFinished
                          ? 'border-gray-200 opacity-75'
                          : 'border-gray-200 hover:bg-gray-50'
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
                          <div className={`text-xs ${isFinished ? 'text-gray-500' : 'text-gray-600'}`}>
                            {job.type === 'external_training' ? (
                              `${job.recordCount || 0} records${job.fileName ? ` (${job.fileName})` : ''}`
                            ) : (job.type === 'learning' || job.type === 'taxonomy_sync') ? (
                              job.status === 'failed' ? (job.errorMessage || 'Failed') : 'Processing...'
                            ) : (
                              <>
                                {job.processedSentences || 0} / {job.totalSentences || 0} sentences
                                {(job.failedSentences || 0) > 0 && (
                                  <span className="text-red-600 ml-1">
                                    ({job.failedSentences} failed)
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isActive && (
                            <span className="text-xs text-gray-600 whitespace-nowrap font-medium">
                              {progress}%
                            </span>
                          )}
                          {isFinished && (
                            <span className={`text-xs whitespace-nowrap ${
                              job.status === 'completed' ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {job.status === 'completed' ? 'Done' : 'Failed'}
                            </span>
                          )}
                          {isActive && (
                            <button
                              onClick={() => handleCancelJob(job)}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                              title="Cancel job"
                            >
                              <X className="w-3 h-3" />
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-300 ${
                            isFinished
                              ? job.status === 'completed' ? 'bg-green-500' : 'bg-red-500'
                              : 'bg-indigo-500'
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
