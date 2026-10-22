'use client'

import { useState } from 'react'
import Modal from '@/components/Modal'
import { formatImportErrors, maxLevelOf, type RowError } from '@/lib/taxonomy-admin'
import type { CsvRow } from '@/lib/utils'
import { workspaceApi } from '@/lib/workspace/urls'
import FileChooser from './FileChooser'
import LevelNameInputs from './LevelNameInputs'
import { CircleCheck, TriangleAlert, X } from 'lucide-react'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'

type ValidationResult = {
  ok: boolean
  message?: string
  error?: string
  errors?: RowError[]
  recordCount?: number
}

/** The deepest level in a taxonomy CSV file; csv-parse is loaded only when needed. */
async function detectMaxDepth(file: File): Promise<number | null> {
  try {
    const { parse } = await import('csv-parse/sync')
    const rows = parse(await file.text(), { columns: true, skip_empty_lines: true, bom: true, cast: false })
    return maxLevelOf(rows as CsvRow[])
  } catch {
    return null
  }
}

/**
 * Creates a taxonomy from a CSV file: key, description, optional validation
 * of the file first, level names (as many as the file's deepest level).
 * Errors stay in the dialog so the form is not lost.
 */
export default function CreateTaxonomyDialog({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: (message: string) => void
}) {
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [levelNames, setLevelNames] = useState<Record<string, string>>({})
  const [file, setFile] = useState<File | null>(null)
  const [detectedMaxDepth, setDetectedMaxDepth] = useState<number | null>(null)
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const depth = detectedMaxDepth ?? 5

  async function chooseFile(next: File | null) {
    setFile(next)
    setValidationResult(null)
    setDetectedMaxDepth(next ? await detectMaxDepth(next) : null)
  }

  async function validateFile() {
    if (!file) return
    setValidating(true)
    setValidationResult(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(workspaceApi('/taxonomies/validate'), { method: 'POST', body })
      setValidationResult(await res.json())
    } catch (caught) {
      const message = (caught as Error).message || 'An unexpected error occurred during validation'
      setValidationResult({ ok: false, error: message, errors: [{ row: 0, message }] })
    } finally {
      setValidating(false)
    }
  }

  async function handleCreate() {
    if (!key || !file) {
      setError('Please fill all required fields and upload a file')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('key', key)
      if (description) body.append('description', description)
      body.append('maxDepth', depth.toString())
      if (Object.keys(levelNames).length > 0) body.append('levelNames', JSON.stringify(levelNames))
      body.append('file', file)

      const res = await fetch(workspaceApi('/taxonomies'), { method: 'POST', body })
      const data = await res.json()
      if (res.ok) {
        onCreated(`Successfully created taxonomy "${key}" with ${data.importedNodes} nodes!`)
      } else {
        setError(formatImportErrors(data.error || 'Failed to create taxonomy', data.errors))
      }
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal label="Create new taxonomy" onClose={onClose}>
      <div className={`${dialogPanelClass} max-w-2xl w-full max-h-[90vh] overflow-y-auto`}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Create taxonomy</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="taxonomy-key" className="block text-sm font-medium text-gray-700 mb-2">
              Key (short name) *
            </label>
            <input
              id="taxonomy-key"
              type="text"
              value={key}
              onChange={e => setKey(e.target.value.toUpperCase())}
              placeholder="e.g. ISCO"
              className="w-full px-3 py-2 border border-gray-500 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-gray-900"
            />
            <p className="text-xs text-gray-600 mt-1">ℹ️ Unique identifier, cannot be changed later</p>
          </div>

          <div>
            <label htmlFor="taxonomy-description" className="block text-sm font-medium text-gray-700 mb-2">
              Description (optional)
            </label>
            <textarea
              id="taxonomy-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Used for job classification worldwide..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-500 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-gray-900"
            />
          </div>

          <div>
            <p className="block text-sm font-medium text-gray-700 mb-2">CSV File *</p>
            <FileChooser id="create-file-input" file={file} onChange={chooseFile}>
              {file && (
                <button
                  onClick={validateFile}
                  disabled={validating}
                  className="px-6 py-2.5 bg-gray-600 text-white font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {validating ? 'Validating…' : 'Validate file'}
                </button>
              )}
            </FileChooser>
            <p className="text-xs text-gray-600 mt-2">
              ℹ️ Required: id, label, parent_id, level | Optional: definition, examples, synonyms
            </p>
            {detectedMaxDepth && (
              <p className="text-xs text-indigo-700 mt-1">
                ✓ Detected maximum depth: {detectedMaxDepth} level{detectedMaxDepth > 1 ? 's' : ''}
              </p>
            )}

            {validationResult && (
              <div
                role={validationResult.ok ? 'status' : 'alert'}
                className={`mt-3 p-4 rounded-lg text-sm ${
                  validationResult.ok
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-lg flex-shrink-0" aria-hidden="true">
                    {validationResult.ok ? <CircleCheck className="w-5 h-5" /> : <TriangleAlert className="w-5 h-5" />}
                  </span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">
                      {validationResult.ok ? 'Validation passed' : 'Validation failed'}
                    </p>
                    {validationResult.ok ? (
                      <p>
                        {validationResult.message ||
                          `File is valid! Found ${validationResult.recordCount || 0} records.`}
                      </p>
                    ) : (
                      <div className="break-words whitespace-pre-wrap text-sm max-h-60 overflow-y-auto">
                        {validationResult.error && <p className="mb-2">{validationResult.error}</p>}
                        {validationResult.errors && validationResult.errors.length > 0 && (
                          <div className="mt-2">
                            <p className="font-medium mb-1">Errors:</p>
                            <ul className="list-disc list-inside space-y-1">
                              {validationResult.errors.slice(0, 20).map((err, idx) => (
                                <li key={idx}>
                                  Row {err.row}: {err.message}
                                </li>
                              ))}
                              {validationResult.errors.length > 20 && (
                                <li className="text-gray-700">
                                  ... and {validationResult.errors.length - 20} more errors
                                </li>
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="block text-sm font-medium text-gray-700 mb-2">Level names (optional)</p>
            <LevelNameInputs depth={depth} levelNames={levelNames} onChange={setLevelNames} />
            {!detectedMaxDepth && !file && (
              <p className="text-xs text-gray-600 mt-2">
                ℹ️ Upload a CSV file to automatically detect the maximum depth
              </p>
            )}
          </div>

          {error && (
            <div role="alert" className="p-4 rounded-lg text-sm bg-red-50 text-red-800 border border-red-200">
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0" aria-hidden="true">
                  <TriangleAlert className="w-5 h-5" />
                </span>
                <div className="flex-1">
                  <p className="font-medium mb-1">Import error</p>
                  <div className="break-words whitespace-pre-wrap text-sm max-h-60 overflow-y-auto">{error}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t border-gray-200">
          <button onClick={onClose} disabled={submitting} className={buttonClass('secondary')}>
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={submitting || !key || !file || (validationResult !== null && !validationResult.ok)}
            className={buttonClass('primary')}
          >
            {submitting ? 'Creating...' : 'Create & Import'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
