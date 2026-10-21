"use client"
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import PageHeader from '@/components/PageHeader'
import FilterPanel, { countActiveFilters, type QueueFilters } from '@/components/queue/FilterPanel'
import QueueToolbar from '@/components/queue/QueueToolbar'
import SentenceRow from '@/components/queue/SentenceRow'
import PaginationControls from '@/components/queue/PaginationControls'
import BulkLabelPanel from '@/components/queue/BulkLabelPanel'
import AssignmentModal from '@/components/queue/AssignmentModal'
import { ToastContainer, type Toast } from '@/components/Toast'
import { createLatestRequest, isAbortError } from '@/lib/latest-request'

export type Sentence = {
  id: string
  field1: string
  field2?: string | null
  field3?: string | null
  field4?: string | null
  field5?: string | null
  fieldMapping: Record<string, string>
  status: string
  flagged: boolean
  lastEditedAt: string | null
  lastEditor?: {
    name: string | null
    username: string | null
    email: string
  } | null
  assignments?: Array<{
    user: {
      id: string
      username: string
      name: string | null
    }
  }>
  annotations: Array<{
    id: string
    level: number
    nodeCode: string
    nodeLabel?: string | null
    source: 'user' | 'ai'
    taxonomy: { key: string }
  }>
  comments?: Array<{
    id: string
    body: string
    createdAt: string
    author: { name: string | null }
  }>
  _count?: {
    comments: number
  }
}

export type QueueResponse = {
  sentences: Sentence[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
}

export type Stats = {
  total: number
  pending: number
  submitted: number
  skipped: number
  flagged: number
  progress: number
}

export type Taxonomy = {
  id?: string
  key: string
  isActive?: boolean
  levelNames?: Record<string, string> | null
  lastAISyncStatus?: string | null
  lastAISyncAt?: string | null
}

export type QueueUser = {
  id: string
  username: string
  name: string | null
}

type UserRole = 'admin' | 'supervisor' | 'labeller'

type QueuePageClientProps = {
  initialQueue: QueueResponse | null
  initialStats: Stats
  initialTaxonomies: Taxonomy[]
  initialUsers: QueueUser[]
  initialCanAssign: boolean
  initialStatsPrefetched: boolean
  currentUser: { id: string; role: UserRole } | null
}

const DEFAULT_FILTERS: QueueFilters = {
  status: [],
  userId: null,
  userScope: 'all',
  assignedToUserId: null,
  lastEditorId: null,
  dateRange: { from: null, to: null },
  taxonomyKey: null,
  level: null,
  code: null,
  source: null,
  aiTaxonomyKey: null,
  aiLevel: null,
  aiCode: null,
  aiConfidenceMin: null,
  aiConfidenceMax: null,
  flagged: null,
  hasComments: null,
  hasSubmittedLabels: null,
  hasAISuggestions: null,
  importId: null,
  supportFilters: {}
}

export default function QueuePageClient({
  initialQueue,
  initialStats,
  initialTaxonomies,
  initialUsers,
  initialCanAssign,
  initialStatsPrefetched,
  currentUser
}: QueuePageClientProps) {
  // UI State - remember filter panel state in localStorage
  const [filterCollapsed, setFilterCollapsed] = useState(true)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem('queueFilterCollapsed')
    setFilterCollapsed(saved !== null ? JSON.parse(saved) : true)
  }, [])
  const toggleFilterPanel = useCallback(() => {
    setFilterCollapsed(prev => {
      const next = !prev
      if (typeof window !== 'undefined') {
        localStorage.setItem('queueFilterCollapsed', JSON.stringify(next))
      }
      return next
    })
  }, [])
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'submitted' | 'skipped'>('pending')
  // What the user types, and the debounced value that queries the server.
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [bulkLabelOpen, setBulkLabelOpen] = useState(false)
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false)
  
  // Data State
  const [queue, setQueue] = useState<QueueResponse | null>(initialQueue)
  const [stats, setStats] = useState<Stats>(initialStats)
  const [taxonomies] = useState<Taxonomy[]>(initialTaxonomies)
  const [loading, setLoading] = useState(false)
  // Set when the last queue request failed; the previous results stay visible.
  const [queueError, setQueueError] = useState<string | null>(null)
  const queueRequest = useRef(createLatestRequest())
  const statsRequest = useRef(createLatestRequest())
  const [canAssign] = useState(initialCanAssign)
  const [users] = useState<QueueUser[]>(initialUsers)
  const skipInitialQueueFetch = useRef(initialQueue !== null)
  const skipInitialStatsFetch = useRef(initialStatsPrefetched)
  const [sendingToAI, setSendingToAI] = useState(false)
  
  // Filter & Pagination State
  const [filters, setFilters] = useState<QueueFilters>(DEFAULT_FILTERS)
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  
  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  
  // Auto-refresh State
  const [lastRefresh, setLastRefresh] = useState(Date.now())
  
  // Toast notifications
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastIdCounter = useRef(0)
  
  const addToast = useCallback((type: Toast['type'], message: string, duration?: number) => {
    const id = `toast-${toastIdCounter.current++}`
    setToasts(prev => [...prev, { id, type, message, duration }])
  }, [])
  
  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])
  
  

  // Fetch stats with current filters applied
  const fetchStats = useCallback(async () => {
    const request = statsRequest.current.start()
    try {
      const params = new URLSearchParams()
      
      // Add search query
      if (searchQuery) params.set('q', searchQuery)
      
      // Add filters (same logic as fetchQueue)
      if (filters.status.length > 0) {
        filters.status.forEach(s => params.append('status', s))
      }
      if (filters.userId) params.set('userId', filters.userId)
      if (filters.assignedToUserId) params.set('assignedToUserId', filters.assignedToUserId)
      if (filters.lastEditorId) params.set('lastEditorId', filters.lastEditorId)
      if (filters.dateRange.from) params.set('dateFrom', filters.dateRange.from)
      if (filters.dateRange.to) params.set('dateTo', filters.dateRange.to)
      if (filters.taxonomyKey) params.set('taxonomyKey', filters.taxonomyKey)
      if (filters.level !== null) params.set('level', String(filters.level))
      if (filters.code !== null) params.set('code', String(filters.code))
      if (filters.hasSubmittedLabels !== null) params.set('hasSubmittedLabels', String(filters.hasSubmittedLabels))
      if (filters.source) params.set('source', filters.source)
      if (filters.aiTaxonomyKey) params.set('aiTaxonomyKey', filters.aiTaxonomyKey)
      if (filters.aiLevel) params.set('aiLevel', filters.aiLevel)
      if (filters.aiCode) params.set('aiCode', filters.aiCode)
      if (filters.aiConfidenceMin !== null) params.set('aiConfidenceMin', filters.aiConfidenceMin)
      if (filters.aiConfidenceMax !== null) params.set('aiConfidenceMax', filters.aiConfidenceMax)
      if (filters.hasAISuggestions !== null) params.set('hasAISuggestions', String(filters.hasAISuggestions))
      if (filters.flagged !== null) params.set('flagged', String(filters.flagged))
      if (filters.hasComments !== null) params.set('hasComments', String(filters.hasComments))
      if (filters.importId) params.set('importId', filters.importId)
      
      // Support filters
      Object.entries(filters.supportFilters).forEach(([key, value]) => {
        if (value) params.set(key, value)
      })
      
      const res = await fetch(`/api/sentences/stats?${params}`, { signal: request.signal })
      if (!res.ok) {
        // Silently ignore transient failures — stats will refresh on next cycle
        return
      }
      const data = await res.json()
      if (data.ok && request.isCurrent()) {
        setStats(data.stats)
      }
    } catch {
      // Network errors during polling are expected (e.g. during deploys)
      // Don't log to avoid console noise
    }
  }, [searchQuery, filters])

  useEffect(() => {
    if (skipInitialStatsFetch.current) {
      skipInitialStatsFetch.current = false
      return
    }
    fetchStats()
  }, [fetchStats, lastRefresh])

  // Fetch sentences
  const fetchQueue = useCallback(async () => {
    const request = queueRequest.current.start()
    setLoading(true)
    try {
      const params = new URLSearchParams()
      
      // Search
      if (searchQuery) params.set('q', searchQuery)
      
      // Tab-based status filter
      if (activeTab !== 'all') {
        params.set('status', activeTab)
      }
      
      // Additional status filters from filter panel
      if (filters.status.length > 0 && activeTab === 'all') {
        params.set('status', filters.status.join(','))
      }
      
      // Other filters
      if (filters.userId) params.set('userId', filters.userId)
      if (filters.assignedToUserId) params.set('assignedToUserId', filters.assignedToUserId)
      if (filters.lastEditorId) params.set('lastEditorId', filters.lastEditorId)
      if (filters.dateRange.from) params.set('lastEditedFrom', filters.dateRange.from)
      if (filters.dateRange.to) params.set('lastEditedTo', filters.dateRange.to)
      if (filters.taxonomyKey) params.set('taxonomyKey', filters.taxonomyKey)
      if (filters.level) params.set('level', filters.level)
      if (filters.code) params.set('code', filters.code)
      if (filters.hasSubmittedLabels !== null) params.set('hasSubmittedLabels', String(filters.hasSubmittedLabels))
      if (filters.source) params.set('source', filters.source)
      if (filters.aiTaxonomyKey) params.set('aiTaxonomyKey', filters.aiTaxonomyKey)
      if (filters.aiLevel) params.set('aiLevel', filters.aiLevel)
      if (filters.aiCode) params.set('aiCode', filters.aiCode)
      if (filters.aiConfidenceMin !== null) params.set('aiConfidenceMin', filters.aiConfidenceMin)
      if (filters.aiConfidenceMax !== null) params.set('aiConfidenceMax', filters.aiConfidenceMax)
      if (filters.hasAISuggestions !== null) params.set('hasAISuggestions', String(filters.hasAISuggestions))
      if (filters.flagged !== null) params.set('flagged', String(filters.flagged))
      if (filters.hasComments !== null) params.set('hasComments', String(filters.hasComments))
      if (filters.importId) params.set('importId', filters.importId)
      
      // Support filters
      Object.entries(filters.supportFilters).forEach(([key, value]) => {
        if (value) params.set(key, value)
      })
      
      // Pagination
      params.set('page', String(page))
      params.set('limit', String(pageSize))
      params.set('sort', 'createdAt')
      params.set('order', 'asc')

      const res = await fetch(`/api/sentences?${params}`, { signal: request.signal })
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`)
      }
      const data = await res.json()
      if (!request.isCurrent()) return
      setQueue(data)
      setQueueError(null)
    } catch (error) {
      // A newer request replaced this one: its outcome no longer matters.
      if (isAbortError(error) || !request.isCurrent()) return
      console.error('Failed to fetch queue:', error)
      // Keep the last good results on screen and say they could not be refreshed,
      // instead of showing an empty queue that looks like "no records".
      setQueueError('Could not load records. The list below may be out of date.')
    } finally {
      if (request.isCurrent()) setLoading(false)
    }
  }, [searchQuery, activeTab, filters, page, pageSize])

  useEffect(() => {
    if (skipInitialQueueFetch.current) {
      skipInitialQueueFetch.current = false
      return
    }
    fetchQueue()
  }, [fetchQueue])

  // Auto-refresh polling (every 30 seconds)
  // Skipped while the tab is hidden; refreshes as soon as it is visible again.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') setLastRefresh(Date.now())
    }, 30000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') setLastRefresh(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Debounce typing: one request when the user pauses, not one per keystroke.
  useEffect(() => {
    if (searchInput === searchQuery) return
    const timeout = setTimeout(() => {
      setSearchQuery(searchInput)
      setPage(1)
      setSelectedIds(new Set())
    }, 300)
    return () => clearTimeout(timeout)
  }, [searchInput, searchQuery])

  // Abandon in-flight requests when leaving the page.
  useEffect(() => {
    const queue = queueRequest.current
    const stats = statsRequest.current
    return () => {
      queue.cancel()
      stats.cancel()
    }
  }, [])

  // Handle tab change
  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab)
    setPage(1)
    setSelectedIds(new Set())
  }

  // Handle filter apply
  const handleApplyFilters = (newFilters: QueueFilters) => {
    setFilters(newFilters)
    setPage(1)
    setSelectedIds(new Set())
  }

  // Handle filter reset
  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS)
    setSearchInput('')
    setSearchQuery('')
    setPage(1)
    setSelectedIds(new Set())
  }

  // Handle search
  const handleSearch = (query: string) => {
    setSearchInput(query)
  }

  // Handle selection
  const handleSelectAll = (checked: boolean) => {
    if (checked && queue) {
      setSelectedIds(new Set(queue.sentences.map(s => s.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  const handleSelect = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedIds)
    if (checked) {
      newSelected.add(id)
    } else {
      newSelected.delete(id)
    }
    setSelectedIds(newSelected)
  }

  // Refresh queue after any changes
  const refreshQueue = async () => {
    await fetchQueue()
    await fetchStats()
  }



  // Handle page size change
  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize)
    setPage(1)
  }

  const allSelected = !!queue && queue.sentences.length > 0 && selectedIds.size === queue.sentences.length
  const someSelected = selectedIds.size > 0
  const isAdmin = currentUser?.role === 'admin'
  const activeTaxonomies = taxonomies.filter(t => t.isActive !== false)
  // A taxonomy is considered synced if it has status 'completed' or 'success' (for backward compatibility)
  const syncedTaxonomies = activeTaxonomies.filter(t => 
    t.lastAISyncStatus === 'completed' || t.lastAISyncStatus === 'success'
  )
  // Show all taxonomies that are not successfully synced (any status other than 'completed' or 'success')
  const unsyncedTaxonomies = activeTaxonomies.filter(t => 
    t.lastAISyncStatus !== 'completed' && t.lastAISyncStatus !== 'success'
  )

  const handleSendSelectedToAI = async () => {
    if (selectedIds.size === 0) {
      addToast('error', 'Select at least one sentence.')
      return
    }

    if (activeTaxonomies.length === 0) {
      addToast('error', 'No active taxonomies available.')
      return
    }

    const unsyncedTaxonomies = activeTaxonomies.filter(t =>
      t.lastAISyncStatus !== 'completed' && t.lastAISyncStatus !== 'success'
    )
    if (unsyncedTaxonomies.length > 0) {
      const names = unsyncedTaxonomies.map(t => t.key).join(', ')
      addToast('error', `Sync required before sending to AI: ${names}`)
      return
    }

    const sentenceIdArray = Array.from(selectedIds)

    try {
      setSendingToAI(true)

      // Fire all taxonomy jobs concurrently — server splits into batches
      const results = await Promise.allSettled(
        syncedTaxonomies.map(async (taxonomy) => {
          const res = await fetch('/api/ai-labeling/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taxonomyKey: taxonomy.key,
              sentenceIds: sentenceIdArray
            })
          })
          const data = await res.json()
          if (!res.ok) {
            throw new Error(data.error || `Failed to start AI job for ${taxonomy.key}`)
          }
          return { taxonomy: taxonomy.key, totalJobs: data.totalJobs || 1 }
        })
      )

      // Report results
      const succeeded = results.filter(r => r.status === 'fulfilled')
      const failed = results.filter(r => r.status === 'rejected')

      if (succeeded.length > 0) {
        const totalJobs = succeeded.reduce(
          (sum, r) => sum + (r as PromiseFulfilledResult<{ totalJobs: number }>).value.totalJobs,
          0
        )
        addToast('info', `Created ${totalJobs} AI job${totalJobs !== 1 ? 's' : ''} — track progress in the badge above.`, 5000)
      }

      if (failed.length > 0) {
        for (const f of failed) {
          const err = (f as PromiseRejectedResult).reason
          addToast('error', err instanceof Error ? err.message : String(err))
        }
      }

      setSelectedIds(new Set())
    } catch (error) {
      console.error('Failed to send sentences to AI:', error)
      addToast('error', error instanceof Error ? error.message : 'Failed to send to AI')
    } finally {
      setSendingToAI(false)
    }
  }
  
  

  const showStatusColumn = activeTab === 'all'
  const contentWidthClass = showStatusColumn ? 'w-[40%]' : 'w-[45%]'
  const labelWidthClass = showStatusColumn ? 'w-[18%]' : 'w-[20%]'

  return (
    <>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <PageHeader 
        title="Queue"
      />

      <div className="flex h-[calc(100vh-66px)]">
        {/* Filter Panel */}
        {!filterCollapsed && (
          <FilterPanel
            collapsed={filterCollapsed}
            onToggle={toggleFilterPanel}
            filters={filters}
            onApply={handleApplyFilters}
            onReset={handleResetFilters}
            taxonomies={taxonomies}
            users={users}
            showAssignedToFilter={currentUser?.role === 'admin' || currentUser?.role === 'supervisor'}
          />
        )}

        {/* Main Content */}
        <div className="relative flex-1 flex flex-col overflow-hidden bg-white">
          {/* Toolbar */}
          <QueueToolbar
            searchQuery={searchInput}
            onSearchChange={handleSearch}
            stats={stats}
            onToggleFilters={toggleFilterPanel}
            activeFilterCount={activeFilterCount}
          />

          {/* Tabs */}
          <div className="border-b border-gray-200 px-6">
            <nav className="flex gap-6">
              {[
                { key: 'all', label: 'All', count: stats.total },
                { key: 'pending', label: 'Pending', count: stats.pending },
                { key: 'submitted', label: 'Submitted', count: stats.submitted },
                { key: 'skipped', label: 'Skipped', count: stats.skipped }
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => handleTabChange(tab.key as typeof activeTab)}
                  className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.key
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label} ({tab.count.toLocaleString()})
                </button>
              ))}
            </nav>
          </div>

          {/* Table */}
          <div className={`flex-1 overflow-auto ${someSelected ? 'pb-20' : ''}`}>
            {queueError && (
              <div role="alert" className="m-4 flex items-center justify-between gap-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <span>{queueError}</span>
                <button
                  type="button"
                  onClick={() => fetchQueue()}
                  className="rounded-md border border-red-300 bg-white px-3 py-1 font-medium hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  Retry
                </button>
              </div>
            )}
            {loading ? (
              <div className="p-12 text-center text-gray-600">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                <p className="mt-2">Loading sentences...</p>
              </div>
            ) : queue?.sentences.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <p className="text-lg">No sentences found</p>
                <p className="text-sm mt-1">Try adjusting your filters or search query</p>
              </div>
            ) : (
              <>
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                    <tr>
                      <th className="pl-4 pr-2 py-3 text-left w-12">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  aria-label="Select all records on this page"
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer"
                />
                      </th>
                      <th className={`pl-0 pr-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider ${contentWidthClass}`}>
                        <span className="block pl-7">Content</span>
                      </th>
                      <th className={`px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider ${labelWidthClass}`}>
                        Labels
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                        Edited
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                        Editor
                      </th>
                    {(currentUser?.role === 'admin' || currentUser?.role === 'supervisor') && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                          Assigned
                        </th>
                      )}
                      {showStatusColumn && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                          Status
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {queue?.sentences.map((sentence, index) => (
                      <SentenceRow
                        key={sentence.id}
                        sentence={sentence}
                        selected={selectedIds.has(sentence.id)}
                        onSelect={(checked) => handleSelect(sentence.id, checked)}
                        showAssignedTo={currentUser?.role === 'admin' || currentUser?.role === 'supervisor'}
                        showStatus={showStatusColumn}
                        contentWidthClass={contentWidthClass}
                        labelWidthClass={labelWidthClass}
                        taxonomies={taxonomies}
                        sentenceIds={queue.sentences.map(s => s.id)}
                        currentIndex={index}
                      />
                    ))}
                  </tbody>
                </table>

                {/* Pagination - below table */}
                {queue && queue.pagination.total > 0 && (
                  <PaginationControls
                    page={page}
                    pageSize={pageSize}
                    total={queue.pagination.total}
                    totalPages={queue.pagination.pages}
                    onPageChange={setPage}
                    onPageSizeChange={handlePageSizeChange}
                  />
                )}
              </>
            )}
          </div>

          {/* Fixed Footer for Bulk Actions */}
          {someSelected && (
            <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-8 py-4 z-20 shadow-lg">
              <div className="flex items-center justify-between max-w-full">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-900">
                    {selectedIds.size} {selectedIds.size === 1 ? 'sentence' : 'sentences'} selected
                  </span>
                  <div className="h-4 w-px bg-gray-300"></div>
                  <button
                    onClick={() => setBulkLabelOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                    title="Apply the same label to all selected sentences"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                    Bulk Label
                  </button>
                  {canAssign && (
                    <button
                      onClick={() => setAssignmentModalOpen(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                      title="Manage user assignments for selected sentences"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      Assign / Unassign
                    </button>
                  )}
                  {isAdmin && activeTaxonomies.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSendSelectedToAI}
                        disabled={
                          sendingToAI ||
                          selectedIds.size === 0 ||
                          unsyncedTaxonomies.length > 0 ||
                          syncedTaxonomies.length === 0
                        }
                        className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        title={
                          unsyncedTaxonomies.length > 0
                            ? 'Sync all taxonomies with AI before sending sentences.'
                            : 'Send selected sentences to AI for all active taxonomies'
                        }
                      >
                        <svg className="w-4 h-4" viewBox="0 0 12 12" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                          <path d="M11.787 6.654l-2.895-1.03-1.081-3.403A.324.324 0 007.5 2c-.143 0-.27.09-.311.221l-1.08 3.404-2.897 1.03A.313.313 0 003 6.946c0 .13.085.248.212.293l2.894 1.03 1.082 3.507A.324.324 0 007.5 12c.144 0 .271-.09.312-.224L8.893 8.27l2.895-1.029A.313.313 0 0012 6.947a.314.314 0 00-.213-.293zM4.448 1.77l-1.05-.39-.39-1.05a.444.444 0 00-.833 0l-.39 1.05-1.05.39a.445.445 0 000 .833l1.05.389.39 1.051a.445.445 0 00.833 0l.39-1.051 1.05-.389a.445.445 0 000-.834z" />
                        </svg>
                        {sendingToAI ? 'Sending…' : 'Send to AI'}
                      </button>
                      {!sendingToAI && unsyncedTaxonomies.length > 0 && (
                        <span className="text-xs text-red-600 whitespace-nowrap">
                          Sync required: {unsyncedTaxonomies.map(t => t.key).join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors text-sm"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

    {/* Bulk Label Panel */}
      {bulkLabelOpen && (
        <BulkLabelPanel
          sentenceIds={Array.from(selectedIds)}
          onClose={() => setBulkLabelOpen(false)}
          onSuccess={refreshQueue}
        />
      )}

      {/* Assignment Modal */}
      {assignmentModalOpen && (
        <AssignmentModal
          sentenceIds={Array.from(selectedIds)}
          onClose={() => setAssignmentModalOpen(false)}
          onSuccess={() => {
            setAssignmentModalOpen(false)
            setSelectedIds(new Set())
            refreshQueue()
          }}
        />
      )}
    </>
  )
}
