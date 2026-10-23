'use client'
import { useState } from 'react'
import Modal from '@/components/Modal'
import { fetchJson } from '@/lib/query/fetch'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'
import { controlClass } from '@/components/users/types'

export type ManagedWorkspace = {
  id: string
  name: string
  description: string | null
  status: 'active' | 'archived'
  role: string
  authority: string
  aiEnabled: boolean
  archivedAt: string | null
  counts: { records: number; members: number; submitted: number; taxonomies: number } | null
}
export default function WorkspaceEditor({
  workspace,
  platform,
  onClose,
  onChanged,
  onDelete
}: {
  workspace: ManagedWorkspace
  platform: boolean
  onClose: () => void
  onChanged: (message: string) => Promise<void>
  onDelete: () => void
}) {
  const [name, setName] = useState(workspace.name)
  const [description, setDescription] = useState(workspace.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (body: unknown, message: string) => {
    setBusy(true)
    setError('')
    try {
      await fetchJson(`/api/workspaces/${workspace.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      await onChanged(message)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update workspace')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      label="Edit workspace"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className={`${dialogPanelClass} p-6 max-w-xl w-full mx-4 max-h-[90dvh] overflow-y-auto space-y-5`}>
        <h2 className="text-xl font-semibold">Edit workspace</h2>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <form
          className="space-y-3"
          onSubmit={e => {
            e.preventDefault()
            void save({ name, description: description || null }, 'Workspace details saved.')
          }}
        >
          <label className="block text-sm">
            Name
            <input
              required
              maxLength={200}
              className={controlClass}
              value={name}
              disabled={workspace.status === 'archived'}
              onChange={e => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Description
            <textarea
              maxLength={2000}
              className={controlClass}
              value={description}
              disabled={workspace.status === 'archived'}
              onChange={e => setDescription(e.target.value)}
            />
          </label>
          <button className={buttonClass('primary')} disabled={busy || workspace.status === 'archived'}>
            Save details
          </button>
        </form>
        <section className="border-t border-gray-200 pt-4 space-y-3">
          <h3 className="font-medium">{workspace.status === 'active' ? 'Archive' : 'Reopen'}</h3>
          <p className="text-sm text-gray-600">
            {workspace.status === 'active'
              ? 'Makes the workspace read-only and cancels queued and running AI jobs. User accounts and saved work are kept. This is reversible.'
              : 'Reopening allows members to work here again. Cancelled AI jobs stay cancelled.'}
          </p>
          <button
            className={buttonClass('secondary')}
            disabled={busy}
            onClick={() =>
              void save(
                { status: workspace.status === 'active' ? 'archived' : 'active' },
                workspace.status === 'active' ? 'Workspace archived.' : 'Workspace reopened.'
              )
            }
          >
            {workspace.status === 'active' ? 'Archive workspace' : 'Reopen workspace'}
          </button>
        </section>
        {platform && (
          <section className="border-t border-gray-200 pt-4 space-y-3">
            <h3 className="font-medium">Delete</h3>
            <p className="text-sm text-gray-600">Only archived workspaces can be permanently deleted.</p>
            <button
              className={buttonClass('secondary')}
              disabled={busy || workspace.status !== 'archived'}
              onClick={onDelete}
            >
              Delete workspace…
            </button>
          </section>
        )}
        <button className={buttonClass('secondary')} disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
