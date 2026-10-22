'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Modal from '@/components/Modal'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetch'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'
import { X } from 'lucide-react'

type User = {
  id: string
  name: string | null
  email: string
  role: 'admin' | 'supervisor' | 'labeller'
}

type AssignmentModalProps = {
  sentenceIds: string[]
  onClose: () => void
  onSuccess: () => void
}

const NONE: ReadonlySet<string> = new Set()

export default function AssignmentModal({ sentenceIds, onClose, onSuccess }: AssignmentModalProps) {
  const { workspaceId, api } = useWorkspacePaths()
  const idsParam = sentenceIds.join(',')

  // /users returns only the people the caller may assign to (everyone for
  // admins, themselves and their team for supervisors).
  const members = useQuery({
    queryKey: queryKeys.members(workspaceId),
    queryFn: ({ signal }) => fetchJson<{ users: User[] }>(api('/users'), { signal }).then(d => d.users)
  })
  // Who is assigned to the selected records now; always asked fresh.
  const current = useQuery({
    queryKey: queryKeys.assignments(workspaceId, idsParam),
    queryFn: ({ signal }) =>
      fetchJson<{ userAssignments?: Record<string, string[]> }>(api(`/sentences/assign?sentenceIds=${idsParam}`), {
        signal
      }).then(d => new Set(Object.keys(d.userAssignments ?? {})) as ReadonlySet<string>),
    staleTime: 0,
    gcTime: 0
  })

  const users = members.data ?? []
  const initialUserIds = current.data ?? NONE
  // The user's choice; until they change something it is the current assignment.
  const [choice, setChoice] = useState<ReadonlySet<string> | null>(null)
  const selectedUserIds = choice ?? initialUserIds
  const setSelectedUserIds = (ids: ReadonlySet<string>) => setChoice(ids)
  const [search, setSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState('')
  const loading = members.isPending || current.isPending
  const error =
    saveError || (members.isError ? 'Failed to load users' : current.isError ? 'Failed to load assignments' : '')
  const setError = setSaveError

  const handleToggleUser = (userId: string) => {
    const newSet = new Set(selectedUserIds)
    if (newSet.has(userId)) {
      newSet.delete(userId)
    } else {
      newSet.add(userId)
    }
    setSelectedUserIds(newSet)
  }

  const handleSelectAll = (shown: User[]) => {
    const next = new Set(selectedUserIds)
    if (allShownSelected) shown.forEach(u => next.delete(u.id))
    else shown.forEach(u => next.add(u.id))
    setSelectedUserIds(next)
  }

  const handleSave = async () => {
    setSubmitting(true)
    setError('')

    try {
      // Compute diff
      const toAdd = Array.from(selectedUserIds).filter(id => !initialUserIds.has(id))
      const toRemove = Array.from(initialUserIds).filter(id => !selectedUserIds.has(id))

      // Nothing changed
      if (toAdd.length === 0 && toRemove.length === 0) {
        onClose()
        return
      }

      const promises: Promise<Response>[] = []

      // Add new assignments
      if (toAdd.length > 0) {
        promises.push(
          fetch(api('/sentences/assign'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sentenceIds, userIds: toAdd })
          })
        )
      }

      // Remove assignments
      if (toRemove.length > 0) {
        promises.push(
          fetch(api('/sentences/assign'), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sentenceIds, userIds: toRemove })
          })
        )
      }

      const results = await Promise.all(promises)

      for (const res of results) {
        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Failed to update assignments')
          setSubmitting(false)
          return
        }
      }

      onSuccess()
      onClose()
    } catch (err) {
      console.error('Assignment error:', err)
      setError('An error occurred')
      setSubmitting(false)
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-indigo-100 text-indigo-700'
      case 'supervisor':
        return 'bg-indigo-100 text-indigo-700'
      case 'labeller':
        return 'bg-green-100 text-green-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  const needle = search.trim().toLowerCase()
  const assignableUsers = needle
    ? users.filter(u => [u.name ?? '', u.email, u.role].some(text => text.toLowerCase().includes(needle)))
    : users
  const allShownSelected = assignableUsers.length > 0 && assignableUsers.every(u => selectedUserIds.has(u.id))

  // Compute diff for button label
  const toAdd = Array.from(selectedUserIds).filter(id => !initialUserIds.has(id))
  const toRemove = Array.from(initialUserIds).filter(id => !selectedUserIds.has(id))
  const hasChanges = toAdd.length > 0 || toRemove.length > 0

  const getButtonLabel = () => {
    if (submitting) return 'Saving...'
    if (!hasChanges) return 'No changes'

    const parts: string[] = []
    if (toAdd.length > 0) parts.push(`assign ${toAdd.length}`)
    if (toRemove.length > 0) parts.push(`unassign ${toRemove.length}`)
    return parts.join(', ').replace(/^./, c => c.toUpperCase())
  }

  return (
    <Modal label="Manage assignments" onClose={onClose}>
      <div className={`${dialogPanelClass} p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col`}>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Manage assignments</h2>
            <p className="text-sm text-gray-600 mt-1">
              {sentenceIds.length} {sentenceIds.length === 1 ? 'sentence' : 'sentences'} selected
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <div className="text-gray-500">Loading...</div>
          </div>
        ) : (
          <>
            {users.length > 5 && (
              <div className="mb-3">
                <label htmlFor="assignment-search" className="sr-only">
                  Search people
                </label>
                <input
                  id="assignment-search"
                  type="search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name, email or role"
                  className="w-full px-3 py-2 border border-gray-500 rounded-lg text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                />
              </div>
            )}

            {/* Select All */}
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-200">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allShownSelected}
                  onChange={() => handleSelectAll(assignableUsers)}
                  className="w-4 h-4 rounded border-gray-500 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-0 cursor-pointer"
                />
                <span className="text-sm font-medium text-gray-700">
                  Select all ({assignableUsers.length} {needle ? 'shown' : 'users'})
                </span>
              </label>
              <div className="flex items-center gap-3 text-sm text-gray-600">
                {selectedUserIds.size > 0 && <span>{selectedUserIds.size} selected</span>}
                {initialUserIds.size > 0 && (
                  <span className="text-gray-500">({initialUserIds.size} currently assigned)</span>
                )}
              </div>
            </div>

            {/* User List */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {assignableUsers.length === 0 ? (
                <div className="text-center py-8 text-gray-600">
                  {needle ? 'Nobody matches this search' : 'No users available for assignment'}
                </div>
              ) : (
                assignableUsers.map(user => {
                  const isSelected = selectedUserIds.has(user.id)
                  const wasInitial = initialUserIds.has(user.id)
                  // Visual cue: green border for newly added, red border for to-be-removed
                  let borderClass = 'border border-transparent'
                  if (isSelected && !wasInitial) {
                    borderClass = 'border border-green-300 bg-green-50'
                  } else if (!isSelected && wasInitial) {
                    borderClass = 'border border-red-300 bg-red-50'
                  }

                  return (
                    <label
                      key={user.id}
                      className={`flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors ${borderClass}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleUser(user.id)}
                        className="w-4 h-4 rounded border-gray-500 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-0 cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{user.name || 'Unnamed user'}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${getRoleBadgeColor(user.role)}`}
                          >
                            {user.role}
                          </span>
                          {isSelected && !wasInitial && (
                            <span className="text-xs text-green-600 font-medium">+ adding</span>
                          )}
                          {!isSelected && wasInitial && (
                            <span className="text-xs text-red-600 font-medium">- removing</span>
                          )}
                        </div>
                        <div className="text-sm text-gray-600 truncate">{user.email}</div>
                      </div>
                    </label>
                  )
                })
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4 mt-4 border-t border-gray-200">
              <button type="button" onClick={onClose} className={buttonClass('secondary', 'md', 'flex-1')}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={submitting || !hasChanges}
                className="flex-1 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {getButtonLabel()}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
