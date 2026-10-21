"use client"
import { useCallback, useEffect, useRef, useState } from 'react'
import PageHeader from '@/components/PageHeader'
import { formatRelativeTime } from '@/lib/utils'
import { createLatestRequest, isAbortError } from '@/lib/latest-request'

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

const ACTION_FILTERS = [
  { value: '', label: 'All events' },
  { value: 'user.', label: 'Users' },
  { value: 'taxonomy.', label: 'Taxonomies' },
  { value: 'records.', label: 'Record imports' },
  { value: 'import.', label: 'Import deletions' },
  { value: 'assignments.', label: 'Assignments' },
  { value: 'labels.', label: 'Bulk labels' },
  { value: 'export.', label: 'Exports' },
  { value: 'ai.', label: 'AI jobs' },
  { value: 'access.denied', label: 'Refused access' },
]

export default function AuditLogPage() {
  const [action, setAction] = useState('')
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(createLatestRequest())

  const load = useCallback(async (cursor: string | null) => {
    const req = request.current.start()
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (action) params.set('action', action)
      if (cursor) params.set('cursor', cursor)
      const res = await fetch(`/api/audit?${params}`, { signal: req.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { entries: AuditEntry[]; nextCursor: string | null }
      if (!req.isCurrent()) return
      setEntries(prev => (cursor ? [...prev, ...data.entries] : data.entries))
      setNextCursor(data.nextCursor)
      setError(null)
    } catch (caught) {
      if (isAbortError(caught) || !req.isCurrent()) return
      setError('Could not load the audit log.')
    } finally {
      if (req.isCurrent()) setLoading(false)
    }
  }, [action])

  useEffect(() => {
    load(null)
  }, [load])

  return (
    <>
      <PageHeader title="Audit Log" />
      <div className="px-8 py-8 space-y-4">
        <p className="text-sm text-gray-600">
          Changes to users, taxonomies, imports, assignments, bulk labels, exports and AI jobs, and refused
          access. Individual label saves, comments and flags are recorded on the records themselves.
        </p>

        <div className="flex items-end gap-4">
          <div className="w-64">
            <label htmlFor="audit-action" className="block text-sm font-medium text-gray-700 mb-2">Show</label>
            <select
              id="audit-action"
              value={action}
              onChange={e => setAction(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {ACTION_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        </div>

        {error && (
          <div role="alert" className="p-4 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
            {error}{' '}
            <button type="button" onClick={() => load(null)} className="underline font-medium">Retry</button>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
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
                  <td className="px-4 py-3 font-mono text-xs break-all">{entry.entityType} {entry.entityId}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 break-all">
                    {entry.payload ? JSON.stringify(entry.payload) : ''}
                  </td>
                </tr>
              ))}
              {!loading && !error && entries.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No events recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-4">
          {nextCursor && (
            <button
              type="button"
              onClick={() => load(nextCursor)}
              disabled={loading}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Load older events
            </button>
          )}
          {loading && <span className="text-sm text-gray-500">Loading…</span>}
        </div>
      </div>
    </>
  )
}
