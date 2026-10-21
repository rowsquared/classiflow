'use client'
import { workspaceApi } from '@/lib/workspace/urls'

import { useState, useEffect, useRef, useCallback } from 'react'
import Modal from '@/components/Modal'

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

export default function AssignmentModal({ sentenceIds, onClose, onSuccess }: AssignmentModalProps) {
  const [users, setUsers] = useState<User[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())
  const [initialUserIds, setInitialUserIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const initialised = useRef(false)

  const loadData = useCallback(async () => {
    try {
      // Fetch users and current assignments in parallel
      const [usersRes, assignRes] = await Promise.all([
        fetch(workspaceApi('/users')),
        fetch(workspaceApi(`/sentences/assign?sentenceIds=${sentenceIds.join(',')}`))
      ])

      if (usersRes.ok) {
        const usersData = await usersRes.json()
        setUsers(usersData.users)
      } else {
        setError('Failed to load users')
      }

      if (assignRes.ok) {
        const assignData = await assignRes.json()
        // userAssignments is { userId: [sentenceId, ...] }
        const currentlyAssigned = new Set<string>(Object.keys(assignData.userAssignments || {}))
        setSelectedUserIds(currentlyAssigned)
        setInitialUserIds(currentlyAssigned)
      }
    } catch (err) {
      console.error('Failed to load data:', err)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [sentenceIds])

  // Load once on open; sentenceIds is a fresh array on every parent render
  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true
      loadData()
    }
  }, [loadData])

  const handleToggleUser = (userId: string) => {
    const newSet = new Set(selectedUserIds)
    if (newSet.has(userId)) {
      newSet.delete(userId)
    } else {
      newSet.add(userId)
    }
    setSelectedUserIds(newSet)
  }

  const handleSelectAll = (assignableUsers: User[]) => {
    if (selectedUserIds.size === assignableUsers.length && assignableUsers.length > 0) {
      setSelectedUserIds(new Set())
    } else {
      setSelectedUserIds(new Set(assignableUsers.map(u => u.id)))
    }
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
          fetch(workspaceApi('/sentences/assign'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sentenceIds, userIds: toAdd })
          })
        )
      }

      // Remove assignments
      if (toRemove.length > 0) {
        promises.push(
          fetch(workspaceApi('/sentences/assign'), {
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

  // /api/users already returns only the users the caller may assign to
  // (everyone for admins, themselves and their team for supervisors).
  const assignableUsers = users

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
    <Modal
      label="Manage assignments"
      onClose={onClose}
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Manage Assignments</h2>
            <p className="text-sm text-gray-600 mt-1">
              {sentenceIds.length} {sentenceIds.length === 1 ? 'sentence' : 'sentences'} selected
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Close">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <div className="text-gray-500">Loading...</div>
          </div>
        ) : (
          <>
            {/* Select All */}
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-200">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedUserIds.size === assignableUsers.length && assignableUsers.length > 0}
                  onChange={() => handleSelectAll(assignableUsers)}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-sm font-medium text-gray-700">Select All ({assignableUsers.length} users)</span>
              </label>
              <div className="flex items-center gap-3 text-sm text-gray-600">
                {selectedUserIds.size > 0 && <span>{selectedUserIds.size} selected</span>}
                {initialUserIds.size > 0 && (
                  <span className="text-gray-400">({initialUserIds.size} currently assigned)</span>
                )}
              </div>
            </div>

            {/* User List */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {assignableUsers.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No users available for assignment</div>
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
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{user.name || 'Unnamed User'}</span>
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
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
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
