'use client'

import { useState } from 'react'
import PageHeader from '@/components/PageHeader'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { formatRelativeTime } from '@/lib/utils'

type Connection = {
  id: string
  version: number
  namespace: string
  createdAt: string
  retiredAt: string | null
  credentialStored: boolean
  endpoint: { id: string; name: string; baseUrl: string }
  endpointRetired: boolean
}

export type AISettings = {
  deployment: { ready: boolean; keysConfigured: boolean; sourceSlugConfigured: boolean }
  enabled: boolean
  namespace: string | null
  active: Connection | null
  versions: Connection[]
  endpoints: Array<{ id: string; name: string; baseUrl: string }>
}

/**
 * A workspace's AI connection: which approved AI service it uses, with which
 * access token, and whether AI is on. The token is write-only: it is sent
 * once, stored encrypted and never shown again.
 */
export default function AISettingsClient({ initial, archived }: { initial: AISettings; archived: boolean }) {
  const { api } = useWorkspacePaths()
  const [settings, setSettings] = useState(initial)
  const [endpointId, setEndpointId] = useState(initial.active?.endpoint.id ?? initial.endpoints[0]?.id ?? '')
  const [credential, setCredential] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const call = async (path: string, method: string, body?: unknown, success?: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(api(path), {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'The change could not be saved' })
        return false
      }
      setSettings(data as AISettings)
      if (success) setMessage({ type: 'success', text: success })
      return true
    } catch {
      setMessage({ type: 'error', text: 'The change could not be saved' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveConnection = async (e: React.FormEvent) => {
    e.preventDefault()
    const saved = await call(
      '/ai-settings/connection',
      'POST',
      { endpointId, credential },
      'Connection saved. Running jobs finish with the previous one.'
    )
    if (saved) setCredential('')
  }

  const { deployment, active } = settings
  const readOnly = archived || !deployment.ready

  return (
    <div className="flex flex-col h-screen">
      <PageHeader title="AI Settings" />

      <div className="flex-1 overflow-y-auto px-8 py-6 max-w-3xl space-y-6">
        {!deployment.ready && (
          <div role="status" className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
            AI is not available on this deployment. A server administrator has to set{' '}
            {!deployment.keysConfigured && <code>AI_CREDENTIALS_KEYS</code>}
            {!deployment.keysConfigured && !deployment.sourceSlugConfigured && ' and '}
            {!deployment.sourceSlugConfigured && <code>AI_SOURCE_SLUG</code>} (see ENV_SETUP.md). Labelling without AI
            works as usual.
          </div>
        )}
        {archived && (
          <div role="status" className="p-4 rounded-lg bg-gray-100 border border-gray-200 text-sm text-gray-700">
            This workspace is archived; its AI settings are read-only.
          </div>
        )}
        {message && (
          <div
            role={message.type === 'error' ? 'alert' : 'status'}
            className={`p-3 rounded-lg text-sm border ${
              message.type === 'error'
                ? 'bg-red-50 text-red-700 border-red-200'
                : 'bg-green-50 text-green-800 border-green-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <section className="p-6 rounded-lg bg-white border border-gray-200">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI suggestions and learning</h2>
              <p className="mt-1 text-sm text-gray-600">
                {settings.enabled
                  ? 'On: admins can sync taxonomies, label records and train the model.'
                  : 'Off: no new AI jobs start. Jobs already running finish.'}
              </p>
            </div>
            <button
              type="button"
              disabled={busy || readOnly || (!settings.enabled && !active)}
              onClick={() =>
                call(
                  '/ai-settings',
                  'PUT',
                  { enabled: !settings.enabled },
                  settings.enabled ? 'AI turned off.' : 'AI turned on.'
                )
              }
              className="shrink-0 px-4 py-2 rounded-lg border text-sm font-medium disabled:opacity-50 border-indigo-600 text-indigo-700 hover:bg-indigo-50"
            >
              {settings.enabled ? 'Turn off' : 'Turn on'}
            </button>
          </div>
          {settings.namespace && (
            <p className="mt-4 text-xs text-gray-600">
              Model namespace: <code className="text-gray-800">{settings.namespace}</code> (only this workspace learns
              from and is labelled by it)
            </p>
          )}
        </section>

        <section className="p-6 rounded-lg bg-white border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Connection</h2>
          {active ? (
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-gray-600">AI service</dt>
              <dd className="text-gray-900">
                {active.endpoint.name} <span className="text-gray-600">({active.endpoint.baseUrl})</span>
                {active.endpointRetired && <span className="ml-2 text-red-700">no longer approved</span>}
              </dd>
              <dt className="text-gray-600">Version</dt>
              <dd className="text-gray-900">
                {active.version}, saved {formatRelativeTime(active.createdAt)}
              </dd>
              <dt className="text-gray-600">Access token</dt>
              <dd className="text-gray-900">{active.credentialStored ? 'stored (encrypted, not shown)' : 'missing'}</dd>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-gray-600">No connection yet.</p>
          )}

          <form onSubmit={saveConnection} className="mt-6 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">{active ? 'Replace the connection' : 'Connect'}</h3>
            {settings.endpoints.length === 0 ? (
              <p className="text-sm text-gray-600">
                No AI service is approved yet. A platform administrator approves services on the Workspaces page.
              </p>
            ) : (
              <>
                <div>
                  <label htmlFor="ai-endpoint" className="block text-sm font-medium text-gray-700 mb-1">
                    AI service
                  </label>
                  <select
                    id="ai-endpoint"
                    value={endpointId}
                    onChange={e => setEndpointId(e.target.value)}
                    disabled={readOnly}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {settings.endpoints.map(endpoint => (
                      <option key={endpoint.id} value={endpoint.id}>
                        {endpoint.name} ({endpoint.baseUrl})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ai-credential" className="block text-sm font-medium text-gray-700 mb-1">
                    Access token
                  </label>
                  <input
                    id="ai-credential"
                    type="password"
                    autoComplete="off"
                    required
                    value={credential}
                    onChange={e => setCredential(e.target.value)}
                    disabled={readOnly}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="mt-1 text-xs text-gray-600">
                    Stored encrypted and never shown again. Saving creates a new version; jobs already running keep the
                    previous one until they finish.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={busy || readOnly || !endpointId || !credential}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Save connection
                  </button>
                  {active && (
                    <button
                      type="button"
                      disabled={busy || archived}
                      onClick={() =>
                        call('/ai-settings/connection', 'DELETE', undefined, 'Connection removed; AI is off.')
                      }
                      className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Remove connection
                    </button>
                  )}
                </div>
              </>
            )}
          </form>
        </section>

        {settings.versions.length > 1 && (
          <section className="p-6 rounded-lg bg-white border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Earlier versions</h2>
            <ul className="mt-3 space-y-1 text-sm text-gray-700">
              {settings.versions
                .filter(v => v.retiredAt)
                .map(v => (
                  <li key={v.id}>
                    Version {v.version}: {v.endpoint.name}, replaced {formatRelativeTime(v.retiredAt!)}
                    {v.credentialStored ? ' (token kept while its jobs run)' : ''}
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
