'use client'
import { workspaceApi } from '@/lib/workspace/urls'
import { useInfiniteQuery } from '@tanstack/react-query'
import { parseAsString, useQueryStates } from 'nuqs'
import PageHeader from '@/components/PageHeader'
import { useWorkspaceInfo } from '@/components/WorkspaceProvider'
import { fetchJson } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { formatRelativeTime } from '@/lib/utils'
import { buttonClass, panelClass } from '@/components/ui/styles'

type AuditEntry = {
  id: string
  createdAt: string
  action: string
  entityType: string
  entityId: string
  actorId: string | null
  actorName: string | null
  payload: unknown
}

type AuditPage = { entries: AuditEntry[]; nextCursor: string | null }

const ACTION_FILTERS = [
  { value: '', label: 'All events' },
  { value: 'user.', label: 'Users' },
  { value: 'member.', label: 'Members' },
  { value: 'mail.', label: 'Mail' },
  { value: 'workspace.', label: 'Workspace' },
  { value: 'taxonomy.', label: 'Taxonomies' },
  { value: 'records.', label: 'Record imports' },
  { value: 'import.', label: 'Import deletions' },
  { value: 'assignments.', label: 'Assignments' },
  { value: 'labels.', label: 'Bulk labels' },
  { value: 'export.', label: 'Exports' },
  { value: 'ai.', label: 'AI jobs' },
  { value: 'access.denied', label: 'Refused access' }
]

// Filters live in the URL (?action=, entityType=, entityId=, actorId=; the
// API's names), so links from elsewhere (a member's history on the Team page)
// open filtered and back/forward restore them.
const auditParsers = {
  action: parseAsString,
  entityType: parseAsString,
  entityId: parseAsString,
  actorId: parseAsString
}
const ENTITY_FILTERS = ['entityType', 'entityId', 'actorId'] as const

export default function AuditLogPage() {
  const workspaceId = useWorkspaceInfo()?.id ?? ''
  const [filters, setFilters] = useQueryStates(auditParsers, { history: 'push' })
  const action = filters.action ?? ''
  const entityFilters = ENTITY_FILTERS.flatMap(key => {
    const value = filters[key]
    return value ? [[key, value] as const] : []
  })

  const params = new URLSearchParams()
  params.set('limit', '50')
  for (const [key, value] of entityFilters) params.set(key, value)
  if (action) params.set('action', action)
  const paramString = params.toString()

  // One query per filter set: changing filters cancels the old request, and
  // "Load older events" appends pages to the same list.
  const { data, error, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } = useInfiniteQuery({
    queryKey: queryKeys.audit(workspaceId, paramString),
    queryFn: ({ pageParam, signal }) => {
      const pageParams = new URLSearchParams(paramString)
      if (pageParam) pageParams.set('cursor', pageParam)
      return fetchJson<AuditPage>(workspaceApi(`/audit?${pageParams}`), { signal })
    },
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
    staleTime: 0
  })
  const entries = data?.pages.flatMap(p => p.entries) ?? []
  const loading = isFetching

  return (
    <>
      <PageHeader title="Audit log" />
      <div className="px-8 py-8 space-y-4">
        <p className="text-sm text-gray-600">
          Changes to users, members, taxonomies, imports, assignments, bulk labels, exports and AI jobs, mail sent, and
          refused access. Individual label saves, comments and flags are recorded on the records themselves.
        </p>

        <div className="flex items-end gap-4">
          <div className="w-64">
            <label htmlFor="audit-action" className="block text-sm font-medium text-gray-700 mb-2">
              Show
            </label>
            <select
              id="audit-action"
              value={action}
              onChange={e => void setFilters({ action: e.target.value || null })}
              className="w-full px-3 py-2 border border-gray-500 rounded-lg text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {ACTION_FILTERS.map(f => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {entityFilters.length > 0 && (
          <div className="flex items-center gap-3 text-sm text-gray-700">
            <span>
              Only entries for{' '}
              {entityFilters
                .map(([k, v]) => `${k === 'actorId' ? 'actor' : k === 'entityId' ? 'object' : 'type'} ${v}`)
                .join(', ')}
            </span>
            <button
              type="button"
              onClick={() => void setFilters({ entityType: null, entityId: null, actorId: null })}
              className="underline text-indigo-700"
            >
              Show all
            </button>
          </div>
        )}

        {error && (
          <div role="alert" className="p-4 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
            Could not load the audit log.{' '}
            <button type="button" onClick={() => void refetch()} className="underline font-medium">
              Retry
            </button>
          </div>
        )}

        <div className={`${panelClass} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-left text-sm font-medium text-gray-700">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Object</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-900">
              {entries.map(entry => (
                <tr key={entry.id} className="align-top">
                  <td className="px-4 py-3 whitespace-nowrap" title={new Date(entry.createdAt).toLocaleString()}>
                    {formatRelativeTime(entry.createdAt)}
                  </td>
                  <td className="px-4 py-3">{entry.actorName ?? (entry.actorId ? entry.actorId : '—')}</td>
                  <td className="px-4 py-3 font-mono text-xs">{entry.action}</td>
                  <td className="px-4 py-3 font-mono text-xs break-all">
                    {entry.entityType} {entry.entityId}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 break-all">
                    {entry.payload ? JSON.stringify(entry.payload) : ''}
                  </td>
                </tr>
              ))}
              {!loading && !error && entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-600">
                    No events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-4">
          {hasNextPage && (
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className={buttonClass('secondary')}
            >
              Load older events
            </button>
          )}
          {loading && <span className="text-sm text-gray-600">Loading…</span>}
        </div>
      </div>
    </>
  )
}
