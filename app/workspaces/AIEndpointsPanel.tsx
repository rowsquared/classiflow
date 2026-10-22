'use client'

import { useState } from 'react'

export type ApprovedEndpoint = {
  id: string
  name: string
  baseUrl: string
  createdAt: string
  retiredAt: string | null
  allWorkspaces: boolean
  workspaceIds: string[]
}

type WorkspaceOption = { id: string; name: string }

type Deployment = { ready: boolean; keysConfigured: boolean; keysError: string | null; sourceSlugConfigured: boolean }

/**
 * Platform admins: the AI services workspaces may connect to. Workspace admins
 * choose one of these in their AI settings and enter their own access token;
 * they cannot enter other addresses. A service is open to every workspace or
 * only to the ones chosen here.
 */
export default function AIEndpointsPanel({
  initialEndpoints,
  deployment,
  workspaces
}: {
  initialEndpoints: ApprovedEndpoint[]
  deployment: Deployment
  workspaces: WorkspaceOption[]
}) {
  const [endpoints, setEndpoints] = useState(initialEndpoints)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The endpoint whose access is being edited, with the draft choice.
  const [editing, setEditing] = useState<{ id: string; all: boolean; ids: Set<string> } | null>(null)
  const workspaceName = new Map(workspaces.map(w => [w.id, w.name]))

  const reload = async () => {
    const res = await fetch('/api/ai-endpoints')
    if (res.ok) setEndpoints((await res.json()).endpoints)
  }

  const approve = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/ai-endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, baseUrl })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'The service could not be approved')
        return
      }
      setName('')
      setBaseUrl('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const retire = async (endpoint: ApprovedEndpoint) => {
    if (!window.confirm(`Retire ${endpoint.name}? Workspaces using it cannot start new AI jobs.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/ai-endpoints/${endpoint.id}`, { method: 'DELETE' })
      if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'The service could not be retired')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const saveAccess = async () => {
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/ai-endpoints/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allWorkspaces: editing.all, workspaceIds: editing.all ? [] : [...editing.ids] })
      })
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || 'The access could not be changed')
        return
      }
      setEditing(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const accessText = (endpoint: ApprovedEndpoint) =>
    endpoint.allWorkspaces
      ? 'all workspaces'
      : endpoint.workspaceIds.length === 0
        ? 'no workspace'
        : endpoint.workspaceIds.map(id => workspaceName.get(id) ?? id).join(', ')

  return (
    <section className="mt-10 p-6 rounded-lg bg-white border border-gray-200 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Approved AI services</h2>
        <p className="mt-1 text-sm text-gray-600">
          Workspace admins connect their workspace to one of these, with the workspace&apos;s own access token.
        </p>
      </div>
      {!deployment.ready && (
        <div role="status" className="p-3 rounded bg-amber-50 border border-amber-200 text-sm text-amber-900">
          AI is not available on this deployment:{' '}
          {deployment.keysError ??
            [
              !deployment.keysConfigured && 'AI_CREDENTIALS_KEYS is not set',
              !deployment.sourceSlugConfigured && 'AI_SOURCE_SLUG is not set'
            ]
              .filter(Boolean)
              .join('; ')}
          .
        </div>
      )}
      {error && (
        <div role="alert" className="p-3 rounded bg-red-50 text-red-700 text-sm border border-red-200">
          {error}
        </div>
      )}
      {endpoints.length > 0 && (
        <ul className="divide-y divide-gray-100 text-sm">
          {endpoints.map(endpoint => (
            <li key={endpoint.id} className="py-2">
              <div className="flex items-center justify-between gap-4">
                <span className={endpoint.retiredAt ? 'text-gray-500' : 'text-gray-900'}>
                  {endpoint.name} <span className="text-gray-600">({endpoint.baseUrl})</span>
                  {endpoint.retiredAt ? (
                    ' · retired'
                  ) : (
                    <span className="block text-xs text-gray-600">Open to {accessText(endpoint)}</span>
                  )}
                </span>
                {!endpoint.retiredAt && (
                  <span className="flex gap-4 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      aria-expanded={editing?.id === endpoint.id}
                      onClick={() =>
                        setEditing(
                          editing?.id === endpoint.id
                            ? null
                            : { id: endpoint.id, all: endpoint.allWorkspaces, ids: new Set(endpoint.workspaceIds) }
                        )
                      }
                      className="text-sm text-indigo-700 hover:underline disabled:opacity-50"
                    >
                      Access
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => retire(endpoint)}
                      className="text-sm text-red-700 hover:underline disabled:opacity-50"
                    >
                      Retire
                    </button>
                  </span>
                )}
              </div>
              {editing?.id === endpoint.id && (
                <fieldset className="mt-3 p-3 rounded border border-gray-200 bg-gray-50 space-y-2">
                  <legend className="sr-only">Workspaces that may use {endpoint.name}</legend>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`access-${endpoint.id}`}
                      checked={editing.all}
                      onChange={() => setEditing({ ...editing, all: true })}
                    />
                    All workspaces, including new ones
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`access-${endpoint.id}`}
                      checked={!editing.all}
                      onChange={() => setEditing({ ...editing, all: false })}
                    />
                    Only these workspaces:
                  </label>
                  {!editing.all && (
                    <ul className="pl-6 space-y-1 max-h-48 overflow-y-auto">
                      {workspaces.map(w => (
                        <li key={w.id}>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={editing.ids.has(w.id)}
                              onChange={e => {
                                const ids = new Set(editing.ids)
                                if (e.target.checked) ids.add(w.id)
                                else ids.delete(w.id)
                                setEditing({ ...editing, ids })
                              }}
                            />
                            {w.name}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-gray-600">
                    Workspaces that lose access start no new jobs on this service; running jobs finish.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={saveAccess}
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                    >
                      Save access
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-white"
                    >
                      Cancel
                    </button>
                  </div>
                </fieldset>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={approve} className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-3 items-end">
        <div>
          <label htmlFor="endpoint-name" className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            id="endpoint-name"
            required
            maxLength={200}
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label htmlFor="endpoint-url" className="block text-sm font-medium text-gray-700 mb-1">
            Base URL
          </label>
          <input
            id="endpoint-url"
            required
            type="url"
            placeholder="https://taxomind.example.org/api"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          Approve
        </button>
      </form>
    </section>
  )
}
