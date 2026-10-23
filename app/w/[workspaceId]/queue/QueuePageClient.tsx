'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useQueryStates } from 'nuqs'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetch'
import { useLastSuccessful } from '@/lib/query/use-last-successful'
import { useStoredBoolean } from '@/lib/use-local-storage'
import {
  EMPTY_QUEUE_FILTERS,
  countActiveFilters,
  pickQueueFilters,
  queueListParams,
  queueParsers,
  queueStatsParams,
  serializeQueueUrlState,
  type QueueFilterValues,
  type QueueTab
} from '@/lib/queue-url'
import PageHeader from '@/components/PageHeader'
import FilterPanel from '@/components/queue/FilterPanel'
import QueueToolbar from '@/components/queue/QueueToolbar'
import SentenceRow from '@/components/queue/SentenceRow'
import PaginationControls from '@/components/queue/PaginationControls'
import BulkLabelPanel from '@/components/queue/BulkLabelPanel'
import AssignmentModal from '@/components/queue/AssignmentModal'
import { ToastContainer, type Toast } from '@/components/Toast'
import { Loader2, Tag, Users } from 'lucide-react'
import { buttonClass } from '@/components/ui/styles'
import { queuePreferenceCookie, queuePreferenceValue } from '@/lib/queue-preferences'

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
  commentSummary?: { total: number; unresolved: number }
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
  needsReview?: number
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
  email?: string
}

type UserRole = 'admin' | 'supervisor' | 'labeller'

type QueuePageClientProps = {
  initialQueue: QueueResponse | null
  /** The list parameters the server loaded initialQueue with (see lib/queue-url.ts). */
  initialListParams: string
  initialStats: Stats
  initialStatsParams: string
  initialTaxonomies: Taxonomy[]
  initialUsers: QueueUser[]
  initialCanAssign: boolean
  currentUser: { id: string; role: UserRole } | null
}

type StatsResponse = { ok?: boolean; stats?: Stats }

const NO_SELECTION: ReadonlySet<string> = new Set()

export default function QueuePageClient({
  initialQueue,
  initialListParams,
  initialStats,
  initialStatsParams,
  initialTaxonomies: taxonomies,
  initialUsers: users,
  initialCanAssign: canAssign,
  currentUser
}: QueuePageClientProps) {
  const { workspaceId, api } = useWorkspacePaths()
  const queryClient = useQueryClient()

  // The view (tab, search, filters, page) is the URL: back/forward and shared
  // links reproduce it, and the server page rendered the same view.
  const [url, setUrl] = useQueryStates(queueParsers)
  const rememberedSearch = serializeQueueUrlState(url)
  const preference = currentUser ? queuePreferenceValue(currentUser, rememberedSearch) : null
  useEffect(() => {
    if (preference === null) return
    const encoded = encodeURIComponent(preference)
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    // Overlong views still work through their URL; clear an older preference instead.
    document.cookie =
      encoded.length <= 3500
        ? `${queuePreferenceCookie(workspaceId)}=${encoded}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
        : `${queuePreferenceCookie(workspaceId)}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
  }, [workspaceId, preference])
  const activeTab = url.tab
  const filters = pickQueueFilters(url)
  const activeFilterCount = countActiveFilters(filters)

  // Filter panel open/closed is a per-browser preference.
  const [filterCollapsed, setFilterCollapsed] = useStoredBoolean('queueFilterCollapsed', true)
  const toggleFilterPanel = () => setFilterCollapsed(!filterCollapsed)

  // What the user types; the URL (and so the request) follows once they pause.
  const [searchInput, setSearchInput] = useState(url.q)
  const [syncedQuery, setSyncedQuery] = useState(url.q)
  if (url.q !== syncedQuery) {
    // The URL changed under us (back/forward, reset): show its search.
    setSyncedQuery(url.q)
    setSearchInput(url.q)
  }
  useEffect(() => {
    if (searchInput === url.q) return
    const timeout = setTimeout(() => setUrl({ q: searchInput || null, page: null }), 300)
    return () => clearTimeout(timeout)
  }, [searchInput, url.q, setUrl])

  const [bulkLabelOpen, setBulkLabelOpen] = useState(false)
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false)
  const [sendingToAI, setSendingToAI] = useState(false)

  // The list. One query per view: a slow answer for an older view lands in
  // that view's cache entry and can never replace what is on screen now, and
  // switching views cancels the request that is no longer needed. Not polled
  // (rows would move under the user's selection); changes made here
  // invalidate it.
  const listParams = queueListParams(url)
  const queueQuery = useQuery({
    queryKey: queryKeys.queueList(workspaceId, listParams),
    queryFn: ({ signal }) => fetchJson<QueueResponse>(api(`/sentences?${listParams}`), { signal }),
    initialData: listParams === initialListParams && initialQueue ? initialQueue : undefined,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: false
  })
  // A failed request keeps the last results on screen, marked out of date,
  // instead of an empty list that would read as "no records".
  const queue = useLastSuccessful(queueQuery.data) ?? null
  const queueError = queueQuery.isError ? 'Could not load records. The list below may be out of date.' : null

  // Tab counts for the same filters, refreshed every 30 s while the tab is visible.
  const statsParams = queueStatsParams(url)
  const statsQuery = useQuery({
    queryKey: queryKeys.queueStats(workspaceId, statsParams),
    queryFn: async ({ signal }) => {
      const data = await fetchJson<StatsResponse>(api(`/sentences/stats?${statsParams}`), { signal })
      if (!data.ok || !data.stats) throw new Error('Statistics unavailable')
      return data.stats
    },
    initialData: statsParams === initialStatsParams ? initialStats : undefined,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    retry: false
  })
  const stats = useLastSuccessful(statsQuery.data) ?? initialStats
  const statsStale = statsQuery.isError

  // Selection belongs to one view (tab, search, filters; not the page).
  const selectionScope = `${activeTab}|${statsParams}`
  const [selection, setSelection] = useState<{ scope: string; ids: ReadonlySet<string> }>({
    scope: selectionScope,
    ids: NO_SELECTION
  })
  const selectedIds = selection.scope === selectionScope ? selection.ids : NO_SELECTION
  const setSelectedIds = (ids: ReadonlySet<string>) => setSelection({ scope: selectionScope, ids })

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

  const handleTabChange = (tab: QueueTab) => {
    setUrl({ tab, page: null }, { history: 'push' })
  }

  const handleApplyFilters = (newFilters: QueueFilterValues) => {
    setUrl({ ...newFilters, page: null }, { history: 'push' })
  }

  const handleResetFilters = () => {
    setUrl({ ...EMPTY_QUEUE_FILTERS, q: null, page: null }, { history: 'push' })
    setSearchInput('')
  }

  const handleSelectAll = (checked: boolean) => {
    if (!queue || queueQuery.isPlaceholderData || queueQuery.isError) return
    const next = new Set(selectedIds)
    queue.sentences.forEach(s => (checked ? next.add(s.id) : next.delete(s.id)))
    setSelectedIds(next)
  }

  const handleSelect = (id: string, checked: boolean) => {
    if (queueQuery.isPlaceholderData || queueQuery.isError) return
    const next = new Set(selectedIds)
    if (checked) next.add(id)
    else next.delete(id)
    setSelectedIds(next)
  }

  // After labels or assignments change: list and counts of every view.
  const refreshQueue = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.queue(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.progress(workspaceId) })
    ])

  const allSelected = !!queue && queue.sentences.length > 0 && queue.sentences.every(s => selectedIds.has(s.id))
  const someSelected = selectedIds.size > 0
  const isAdmin = currentUser?.role === 'admin'
  const activeTaxonomies = taxonomies.filter(t => t.isActive !== false)
  // A taxonomy is synced once its last AI sync completed
  const syncedTaxonomies = activeTaxonomies.filter(t => t.lastAISyncStatus === 'completed')
  // Show all taxonomies that are not successfully synced
  const unsyncedTaxonomies = activeTaxonomies.filter(t => t.lastAISyncStatus !== 'completed')

  const handleSendSelectedToAI = async () => {
    if (selectedIds.size === 0) {
      addToast('error', 'Select at least one sentence.')
      return
    }

    if (activeTaxonomies.length === 0) {
      addToast('error', 'No active taxonomies available.')
      return
    }

    const unsyncedTaxonomies = activeTaxonomies.filter(t => t.lastAISyncStatus !== 'completed')
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
        syncedTaxonomies.map(async taxonomy => {
          const res = await fetch(api('/ai-labeling/jobs'), {
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
        addToast(
          'info',
          `Created ${totalJobs} AI job${totalJobs !== 1 ? 's' : ''} — track progress in the badge above.`,
          5000
        )
      }

      if (failed.length > 0) {
        for (const f of failed) {
          const err = (f as PromiseRejectedResult).reason
          addToast('error', err instanceof Error ? err.message : String(err))
        }
      }

      setSelectedIds(NO_SELECTION)
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
      <PageHeader title="Queue" />

      <div className="flex h-[calc(100vh-66px)]">
        {/* Filter Panel */}
        {!filterCollapsed && (
          <FilterPanel
            key={JSON.stringify(filters)}
            onClose={toggleFilterPanel}
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
            statsStale={statsStale}
            onSearchChange={setSearchInput}
            stats={stats}
            onToggleFilters={toggleFilterPanel}
            activeFilterCount={activeFilterCount}
            needsReview={stats.needsReview ?? 0}
            needsReviewActive={url.double === 'review'}
            onToggleNeedsReview={
              currentUser?.role === 'admin' || currentUser?.role === 'supervisor'
                ? () =>
                    setUrl(
                      { double: url.double === 'review' ? null : 'review', tab: 'all', page: null },
                      { history: 'push' }
                    )
                : undefined
            }
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
                  onClick={() => handleTabChange(tab.key as QueueTab)}
                  aria-current={activeTab === tab.key ? 'page' : undefined}
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
              <div
                role="alert"
                className="m-4 flex items-center justify-between gap-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                <span>{queueError}</span>
                <button
                  type="button"
                  onClick={() => queueQuery.refetch()}
                  className="rounded-md border border-red-300 bg-white px-3 py-1 font-medium hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  Retry
                </button>
              </div>
            )}
            {!queue ? (
              <div className="p-12 text-center text-gray-600">
                <Loader2 className="inline-block h-8 w-8 animate-spin text-indigo-600" aria-hidden="true" />
                <p className="mt-2">Loading records…</p>
              </div>
            ) : queue?.sentences.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <p className="text-lg">No sentences found</p>
                <p className="text-sm mt-1">Try adjusting your filters or search query</p>
              </div>
            ) : (
              <>
                <table
                  className={`w-full transition-opacity ${queueQuery.isPlaceholderData ? 'opacity-60' : ''}`}
                  aria-busy={queueQuery.isFetching}
                >
                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                    <tr>
                      <th className="pl-4 pr-2 py-3 text-left w-12">
                        <input
                          type="checkbox"
                          disabled={queueQuery.isPlaceholderData || queueQuery.isError}
                          checked={allSelected}
                          onChange={e => handleSelectAll(e.target.checked)}
                          aria-label="Select all records on this page"
                          className="w-4 h-4 rounded border-gray-500 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-0 cursor-pointer"
                        />
                      </th>
                      <th className={`pl-0 pr-4 py-3 text-left text-sm font-medium text-gray-700 ${contentWidthClass}`}>
                        <span className="block pl-7">Content</span>
                      </th>
                      <th className={`px-4 py-3 text-left text-sm font-medium text-gray-700 ${labelWidthClass}`}>
                        Labels
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Edited</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Editor</th>
                      {(currentUser?.role === 'admin' || currentUser?.role === 'supervisor') && (
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Assigned</th>
                      )}
                      {showStatusColumn && (
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Status</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {queue?.sentences.map((sentence, index) => (
                      <SentenceRow
                        key={sentence.id}
                        sentence={sentence}
                        selectionDisabled={queueQuery.isPlaceholderData || queueQuery.isError}
                        selected={selectedIds.has(sentence.id)}
                        onSelect={checked => handleSelect(sentence.id, checked)}
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
                    page={queue.pagination.page}
                    pageSize={queue.pagination.limit}
                    total={queue.pagination.total}
                    totalPages={queue.pagination.pages}
                    onPageChange={page => setUrl({ page }, { history: 'push' })}
                    onPageSizeChange={limit => setUrl({ limit, page: null }, { history: 'push' })}
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
                    className={buttonClass('primary')}
                    title="Apply the same label to all selected sentences"
                  >
                    <Tag className="w-4 h-4" aria-hidden="true" />
                    Bulk label
                  </button>
                  {canAssign && (
                    <button
                      onClick={() => setAssignmentModalOpen(true)}
                      className={buttonClass('secondary')}
                      title="Manage user assignments for selected sentences"
                    >
                      <Users className="w-4 h-4" aria-hidden="true" />
                      Assign / unassign
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
                        className={buttonClass('secondary')}
                        title={
                          unsyncedTaxonomies.length > 0
                            ? 'Sync all taxonomies with AI before sending sentences.'
                            : 'Send selected sentences to AI for all active taxonomies'
                        }
                      >
                        <svg
                          className="w-4 h-4"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                          xmlns="http://www.w3.org/2000/svg"
                        >
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
                <button onClick={() => setSelectedIds(NO_SELECTION)} className={buttonClass('ghost', 'sm')}>
                  Clear selection
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
          onComplete={() => setSelectedIds(NO_SELECTION)}
        />
      )}

      {/* Assignment Modal */}
      {assignmentModalOpen && (
        <AssignmentModal
          sentenceIds={Array.from(selectedIds)}
          onClose={() => setAssignmentModalOpen(false)}
          onSuccess={() => {
            setAssignmentModalOpen(false)
            setSelectedIds(NO_SELECTION)
            refreshQueue()
          }}
        />
      )}
    </>
  )
}
