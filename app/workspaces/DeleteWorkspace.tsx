'use client'
import { useState } from 'react'
import { queryKeys } from '@/lib/query/keys'
import { useQuery } from '@tanstack/react-query'
import Modal from '@/components/Modal'
import { fetchJson } from '@/lib/query/fetch'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'
import { controlClass } from '@/components/users/types'
import type { ManagedWorkspace } from './WorkspaceEditor'

export default function DeleteWorkspace({
  workspace,
  onClose,
  onDeleted
}: {
  workspace: ManagedWorkspace
  onClose: () => void
  onDeleted: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preview = useQuery({
    queryKey: queryKeys.deletionPreview(workspace.id),
    queryFn: ({ signal }) =>
      fetchJson<{ workspace: { name: string; status: string }; counts: Record<string, number> }>(
        `/api/workspaces/${workspace.id}/deletion-preview`,
        { signal }
      ),
    staleTime: 0
  })
  const groups: Array<[string, string[]]> = [
    ['Records', ['Sentence']],
    ['Labels (one per level)', ['SentenceAnnotation', 'DoubleTaskLabel']],
    ['Comments', ['Comment']],
    ['Taxonomies', ['Taxonomy']],
    ['Classification codes', ['TaxonomyNode']],
    ['Memberships', ['WorkspaceMembership']],
    ['AI jobs', ['AILabelingJob', 'AILearningJob', 'AITaxonomySyncJob']],
    ['AI connections', ['AIConnectionVersion']],
    ['Invitations', ['WorkspaceInvitation']],
    ['Email delivery history', ['OutgoingMail']],
    ['Record and member imports', ['SentenceImport', 'MemberImport']],
    ['Audit entries', ['AuditLog']],
    ['Labelling activity', ['LabelingActivity']],
    ['Double-annotation rounds', ['DoubleRound']]
  ]
  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await fetchJson(`/api/workspaces/${workspace.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      await onDeleted()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete workspace')
      void preview.refetch()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      label="Delete workspace"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div
        className={`${dialogPanelClass} p-6 max-w-xl w-full mx-4 max-h-[90dvh] overflow-y-auto space-y-4 text-gray-900`}
      >
        <h2 className="text-xl font-semibold">Delete workspace</h2>
        <p className="text-sm">
          This permanently deletes “{preview.data?.workspace.name ?? workspace.name}” and all its local records,
          classifications, assignments, history and settings.
        </p>
        {preview.isPending && <p role="status">Loading deletion preview…</p>}
        {preview.isError && (
          <p role="alert" className="text-red-700">
            Could not load the deletion preview.{' '}
            <button className="underline" onClick={() => void preview.refetch()}>
              Try again
            </button>
          </p>
        )}
        {preview.data && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {groups.map(([label, tables]) => (
              <div key={label} className="contents">
                <dt className="text-gray-600">{label}</dt>
                <dd>{tables.reduce((sum, table) => sum + (preview.data?.counts[table] ?? 0), 0).toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-sm">User accounts are kept. Export records first if you need them. This cannot be undone.</p>
        <p className="text-sm text-amber-900">
          Data held by the external AI service remains. Deletion attempts to cancel its jobs, but does not delete its
          namespace or training data.
        </p>
        <label className="block text-sm">
          Type {preview.data?.workspace.name ?? workspace.name} to confirm
          <input className={controlClass} autoComplete="off" value={name} onChange={e => setName(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button disabled={busy} className={buttonClass('secondary')} onClick={onClose}>
            Cancel
          </button>
          <button
            disabled={
              busy ||
              !preview.data ||
              preview.isError ||
              preview.data.workspace.status !== 'archived' ||
              name !== preview.data.workspace.name
            }
            className={buttonClass('danger')}
            onClick={() => void remove()}
          >
            {busy ? 'Deleting…' : 'Delete workspace'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
