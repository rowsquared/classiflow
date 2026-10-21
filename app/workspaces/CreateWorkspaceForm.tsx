'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Platform admins: a new workspace with themselves as its first admin. */
export default function CreateWorkspaceForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || null }),
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
      {error && <div role="alert" className="p-3 rounded bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>}
      <div>
        <label htmlFor="workspace-name" className="block text-sm font-medium text-gray-700 mb-1">Name</label>
        <input
          id="workspace-name" required maxLength={200} value={name} onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label htmlFor="workspace-description" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea
          id="workspace-description" maxLength={2000} value={description} onChange={e => setDescription(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <button
        type="submit" disabled={saving}
        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
      >
        {saving ? 'Creating…' : 'Create workspace'}
      </button>
    </form>
  )
}
