'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import Combobox from '@/components/ui/Combobox'
import QueryProvider from '@/components/QueryProvider'
import { fetchJson } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { buttonClass } from '@/components/ui/styles'

type Candidate = { id: string; name: string; email: string }

/** Platform admins: a new workspace with a chosen first admin (themselves by default). */
export default function CreateWorkspaceForm() {
  return (
    <QueryProvider>
      <CreateWorkspace />
    </QueryProvider>
  )
}

function CreateWorkspace() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [admin, setAdmin] = useState<Candidate | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const q = useDebouncedValue(search.trim(), 300)
  // Enabled accounts only: a disabled account cannot be a usable first admin.
  const params = new URLSearchParams({ q, state: 'active', pageSize: '10' })
  const candidates = useQuery({
    queryKey: queryKeys.accountsPage(params.toString()),
    queryFn: ({ signal }) => fetchJson<{ users: Candidate[] }>(`/api/users?${params}`, { signal }),
    placeholderData: keepPreviousData
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || null, ...(admin ? { adminUserId: admin.id } : {}) })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not create the workspace')
        return
      }
      router.push(`/w/${data.workspace.id}/admin/taxonomy`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-10 p-6 rounded-lg bg-white border border-gray-200 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">New workspace</h2>
      {error && (
        <div role="alert" className="p-3 rounded bg-red-50 text-red-700 text-sm border border-red-200">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="workspace-name" className="block text-sm font-medium text-gray-700 mb-1">
          Name
        </label>
        <input
          id="workspace-name"
          required
          maxLength={200}
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-500 rounded-lg text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        />
      </div>
      <div>
        <label htmlFor="workspace-description" className="block text-sm font-medium text-gray-700 mb-1">
          Description
        </label>
        <textarea
          id="workspace-description"
          maxLength={2000}
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="w-full px-3 py-2 border border-gray-500 rounded-lg text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        />
      </div>
      <Combobox
        label="First admin"
        labelClassName="block text-sm font-medium text-gray-700 mb-1"
        placeholder="You (search to choose someone else)"
        options={(candidates.data?.users ?? []).map(u => ({ value: u.id, label: u.name, hint: u.email }))}
        value={admin?.id ?? null}
        selectedLabel={admin ? admin.name : undefined}
        onQueryChange={setSearch}
        onChange={(_value, option) =>
          setAdmin(option ? { id: option.value, name: option.label, email: option.hint ?? '' } : null)
        }
        loading={candidates.isFetching}
        emptyText="No enabled user matches"
      >
        <p className="mt-1 text-xs text-gray-600">
          {admin
            ? `${admin.name} (${admin.email}) becomes the workspace admin. You keep access as a platform admin.`
            : 'Without a choice, you become the first admin.'}
        </p>
      </Combobox>
      <button type="submit" disabled={saving} className={buttonClass('primary')}>
        {saving ? 'Creating…' : 'Create workspace'}
      </button>
    </form>
  )
}
