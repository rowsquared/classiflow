'use client'

import { useState } from 'react'
import Modal from '@/components/Modal'
import { workspaceApi } from '@/lib/workspace/urls'
import type { Message, Taxonomy } from './types'

/** Deletes a taxonomy and everything attached to it, after typing DELETE. */
export default function DeleteTaxonomyDialog({
  taxonomy,
  onClose,
  onDeleted,
  onMessage
}: {
  taxonomy: Taxonomy
  onClose: () => void
  onDeleted: (message: string) => void
  onMessage: (message: Message | null) => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleDelete() {
    if (confirmText !== 'DELETE') return
    setSubmitting(true)
    onMessage(null)
    try {
      const res = await fetch(workspaceApi(`/taxonomies/${taxonomy.key}`), { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        const deletedInfo = data.deleted
          ? `Deleted ${data.deleted.nodes} nodes, ${data.deleted.annotations} annotations, ${data.deleted.aiSuggestions} AI suggestions, and ${data.deleted.synonyms} synonyms.`
          : 'Taxonomy and all associated data deleted successfully.'
        onDeleted(`Successfully deleted taxonomy "${taxonomy.key}". ${deletedInfo}`)
      } else {
        onMessage({ type: 'error', text: data.error || 'Failed to delete taxonomy' })
      }
    } catch {
      onMessage({ type: 'error', text: 'Network error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      label="Delete taxonomy"
      onClose={() => {
        if (!submitting) onClose()
      }}
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
    >
      <div className="bg-white rounded-lg max-w-md w-full shadow-xl">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-red-700">⚠️ Danger Zone</h2>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-gray-700">You are about to delete taxonomy:</p>
          <p className="font-semibold text-gray-900">&quot;{taxonomy.key}&quot;</p>

          <div className="text-sm text-gray-600 space-y-1">
            <p>This will:</p>
            <ul className="list-disc list-inside pl-2">
              <li>Permanently delete the taxonomy and all associated data</li>
              <li>
                Delete {taxonomy.nodeCount} nodes and {taxonomy.annotationCount} annotations
              </li>
              <li>Delete all AI suggestions for this taxonomy</li>
              <li>This action cannot be undone</li>
            </ul>
          </div>

          <div>
            <label htmlFor="delete-taxonomy-confirm" className="block text-sm font-medium text-gray-700 mb-2">
              Type <code className="bg-gray-100 px-2 py-1 rounded text-red-700 font-mono">DELETE</code> to confirm:
            </label>
            <input
              id="delete-taxonomy-confirm"
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-gray-900"
              autoFocus
            />
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={confirmText !== 'DELETE' || submitting}
            className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Deleting...' : 'Delete Taxonomy'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
