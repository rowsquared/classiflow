'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs'
import { useQueryClient } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal } from 'lucide-react'
import Modal from '@/components/Modal'
import { queryKeys } from '@/lib/query/keys'
import { buttonClass, panelClass, dialogPanelClass, badgeClass } from '@/components/ui/styles'
import { controlClass } from '@/components/users/types'
import CreateWorkspaceForm from './CreateWorkspaceForm'
import WorkspaceEditor, { type ManagedWorkspace } from './WorkspaceEditor'
import DeleteWorkspace from './DeleteWorkspace'

export default function WorkspacesClient({
  workspaces,
  platform
}: {
  workspaces: ManagedWorkspace[]
  platform: boolean
}) {
  const [status, setStatus] = useQueryState(
    'status',
    parseAsStringLiteral(['active', 'archived', 'all'] as const)
      .withDefault('active')
      .withOptions({ history: 'push' })
  )
  const [editId, setEditId] = useQueryState('edit', parseAsString.withOptions({ history: 'push' }))
  const [deleting, setDeleting] = useState<ManagedWorkspace | null>(null)
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState('')
  const cache = useQueryClient()
  const router = useRouter()
  const shown = workspaces.filter(w => !platform || status === 'all' || w.status === status)
  const editing = workspaces.find(w => w.id === editId && w.role === 'admin')
  const changed = async (message: string) => {
    setMessage(message)
    await cache.invalidateQueries({ queryKey: queryKeys.workspaces() })
    router.refresh()
  }
  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-6 text-gray-900">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Workspaces</h1>
          <p className="text-sm text-gray-600 mt-1">
            Each workspace is a separate classification exercise with its own records, taxonomies, members and roles.
          </p>
        </div>
        {platform && (
          <button className={buttonClass('primary')} onClick={() => setCreating(true)}>
            New workspace
          </button>
        )}
      </header>
      {platform && (
        <label className="block text-sm text-gray-700 max-w-48">
          Status
          <select
            className={controlClass}
            value={status}
            onChange={e => void setStatus(e.target.value as typeof status)}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All workspaces</option>
          </select>
        </label>
      )}
      {message && (
        <p role="status" className="text-sm text-gray-700">
          {message}
        </p>
      )}
      <p className="text-sm text-gray-600">{shown.length} workspaces</p>
      <ul className={`${panelClass} divide-y divide-gray-200`}>
        {shown.map(w => (
          <li key={w.id} className="p-5 space-y-2">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <h2 className="font-medium">
                {w.name} {w.status === 'archived' && <span className={badgeClass()}>Archived · read-only</span>}
              </h2>
              <div className="flex items-center gap-2">
                <Link className={buttonClass('secondary', 'sm')} href={`/w/${w.id}/queue`} prefetch={false}>
                  Open<span className="sr-only"> {w.name}</span>
                </Link>
                {w.role === 'admin' && (
                  <>
                    <button className={buttonClass('secondary', 'sm')} onClick={() => void setEditId(w.id)}>
                      Edit<span className="sr-only"> {w.name}</span>
                    </button>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button aria-label={`Actions for ${w.name}`} className={buttonClass('ghost', 'sm')}>
                          <MoreHorizontal size={18} />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="z-50 bg-white border border-gray-200 shadow-lg p-1 min-w-48"
                          align="end"
                        >
                          <DropdownMenu.Item asChild>
                            <Link
                              href={`/users?workspace=${w.id}`}
                              className="block px-3 py-2 text-sm outline-none data-[highlighted]:bg-gray-100"
                            >
                              Manage users
                            </Link>
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            onSelect={() => void setEditId(w.id)}
                            className="px-3 py-2 text-sm cursor-pointer outline-none data-[highlighted]:bg-gray-100"
                          >
                            {w.status === 'active' ? 'Archive…' : 'Reopen…'}
                          </DropdownMenu.Item>
                          {platform && (
                            <DropdownMenu.Item
                              onSelect={() => setDeleting(w)}
                              disabled={w.status !== 'archived'}
                              className="px-3 py-2 text-sm text-red-700 cursor-pointer outline-none data-[highlighted]:bg-gray-100 data-[disabled]:text-gray-600"
                            >
                              Delete…{w.status === 'active' ? ' (archive first)' : ''}
                            </DropdownMenu.Item>
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </>
                )}
              </div>
            </div>
            {w.description && <p className="text-sm text-gray-600">{w.description}</p>}
            {w.counts ? (
              <p className="text-sm text-gray-600">
                Members {w.counts.members.toLocaleString()} · Records {w.counts.records.toLocaleString()} · Submitted{' '}
                {w.counts.records ? Math.round((w.counts.submitted / w.counts.records) * 100) : 0}% · Taxonomies{' '}
                {w.counts.taxonomies}
                {w.aiEnabled ? ' · AI on' : ''}
              </p>
            ) : (
              <p className="text-sm text-gray-600">{w.role}</p>
            )}
            {w.status === 'archived' && w.archivedAt && (
              <p className="text-sm text-gray-600">Archived {new Date(w.archivedAt).toLocaleDateString()}</p>
            )}
          </li>
        ))}
        {!shown.length && (
          <li className="p-6 text-sm text-gray-600">
            {workspaces.length
              ? 'No workspaces match this status.'
              : 'You are not a member of any workspace yet. Ask a workspace administrator to add you.'}
          </li>
        )}
      </ul>
      {creating && (
        <Modal label="New workspace" onClose={() => setCreating(false)}>
          <div className={`${dialogPanelClass} p-6 max-w-xl w-full mx-4 max-h-[90dvh] overflow-y-auto`}>
            <CreateWorkspaceForm />
            <button className={buttonClass('secondary')} onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
      {editing && (
        <WorkspaceEditor
          key={`${editing.id}:${editing.status}`}
          workspace={editing}
          platform={platform}
          onClose={() => void setEditId(null)}
          onChanged={changed}
          onDelete={() => {
            void setEditId(null)
            setDeleting(editing)
          }}
        />
      )}
      {deleting && (
        <DeleteWorkspace
          workspace={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null)
            await changed('Workspace deleted. User accounts were kept.')
          }}
        />
      )}
    </div>
  )
}
