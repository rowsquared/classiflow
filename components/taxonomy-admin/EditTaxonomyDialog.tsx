'use client'

import { useState } from 'react'
import Modal from '@/components/Modal'
import { formatImportErrors } from '@/lib/taxonomy-admin'
import { workspaceApi } from '@/lib/workspace/urls'
import FileChooser from './FileChooser'
import LevelNameInputs from './LevelNameInputs'
import type { Message, Taxonomy } from './types'

/**
 * Edits a taxonomy's description and level names, and optionally replaces
 * all its nodes from a CSV file. Replacing nodes that labels still use needs
 * a confirmation (409 ORPHANED_LABELS, then again with confirmOrphans).
 * Results go to the page's message line, as before the split.
 */
export default function EditTaxonomyDialog({
  taxonomy,
  onClose,
  onSaved,
  onMessage
}: {
  taxonomy: Taxonomy
  onClose: () => void
  onSaved: (message: string) => void
  onMessage: (message: Message | null) => void
}) {
  const [description, setDescription] = useState(taxonomy.description || '')
  const [maxDepth, setMaxDepth] = useState(taxonomy.maxDepth)
  const [levelNames, setLevelNames] = useState<Record<string, string>>(taxonomy.levelNames || {})
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleEdit(confirmOrphans = false) {
    setSubmitting(true)
    onMessage(null)
    try {
      const body = new FormData()
      body.append('description', description)
      body.append('levelNames', JSON.stringify(levelNames))
      if (file) body.append('file', file)
      if (confirmOrphans) body.append('confirmOrphans', 'true')

      const res = await fetch(workspaceApi(`/taxonomies/${taxonomy.key}`), { method: 'PUT', body })
      const data = await res.json()

      // The new file drops codes that existing labels use: replace only if the admin agrees.
      if (res.status === 409 && data.code === 'ORPHANED_LABELS') {
        setSubmitting(false)
        if (window.confirm(`${data.error}\n\nReplace the taxonomy anyway?`)) {
          await handleEdit(true)
        }
        return
      }

      if (res.ok) {
        const nodesMsg = data.nodesReplaced > 0 ? ` and replaced ${data.nodesReplaced} nodes` : ''
        onSaved(`Successfully updated taxonomy "${taxonomy.key}"${nodesMsg}!`)
      } else {
        onMessage({ type: 'error', text: formatImportErrors(data.error || 'Failed to update taxonomy', data.errors) })
      }
    } catch {
      onMessage({ type: 'error', text: 'Network error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      label={`Edit taxonomy ${taxonomy.key}`}
      onClose={onClose}
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
    >
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Edit Taxonomy: {taxonomy.key}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl" aria-label="Close">
            ×
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="edit-taxonomy-key" className="block text-sm font-medium text-gray-600 mb-2">
              Key (cannot be changed)
            </label>
            <input
              id="edit-taxonomy-key"
              type="text"
              value={taxonomy.key}
              disabled
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed"
            />
          </div>

          <div>
            <label htmlFor="edit-taxonomy-description" className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              id="edit-taxonomy-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
            />
          </div>

          <div>
            <label htmlFor="edit-taxonomy-depth" className="block text-sm font-medium text-gray-700 mb-2">
              Maximum Depth (current: {taxonomy.maxDepth})
            </label>
            <select
              id="edit-taxonomy-depth"
              value={maxDepth}
              onChange={e => setMaxDepth(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
            >
              {[1, 2, 3, 4, 5].map(d => (
                <option key={d} value={d}>
                  {d} level{d > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="block text-sm font-medium text-gray-700 mb-2">Level Names</p>
            <LevelNameInputs depth={maxDepth} levelNames={levelNames} onChange={setLevelNames} />
          </div>

          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-orange-800 mb-2">⚠️ Update Nodes (optional)</h3>
            <div className="mb-2">
              <FileChooser id="edit-file-input" file={file} onChange={setFile} />
            </div>
            <p className="text-xs text-orange-800">
              ⚠️ WARNING: This will REPLACE all existing nodes with the uploaded CSV
            </p>
          </div>
        </div>

        <div className="sticky bottom-0 bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={() => handleEdit()}
            disabled={submitting}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
