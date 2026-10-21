'use client'

import { useState, useCallback } from 'react'
import PageHeader from '@/components/PageHeader'
import { formatDateTime } from '@/lib/utils'
import Modal from '@/components/Modal'

export type SentenceImport = {
  id: string
  fileName: string
  uploadedAt: string
  totalRows: number
  sentenceCount: number
}

type Props = {
  initialImports: SentenceImport[]
}

export default function SentenceAdminClient({ initialImports }: Props) {
  const [sentenceFile, setSentenceFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [imports, setImports] = useState<SentenceImport[]>(initialImports)
  const [loadingImports, setLoadingImports] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [selectedImport, setSelectedImport] = useState<SentenceImport | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const refreshImports = useCallback(async () => {
    try {
      setLoadingImports(true)
      const res = await fetch('/api/imports', { cache: 'no-store' })
      const data = await res.json()
      if (data.ok) {
        setImports(data.imports)
      }
    } catch (error) {
      console.error('Failed to load imports:', error)
    } finally {
      setLoadingImports(false)
    }
  }, [])

  const handleDeleteImport = useCallback(async () => {
    if (!selectedImport || confirmText !== 'DELETE') return

    try {
      setDeleting(true)
      const res = await fetch(`/api/imports/${selectedImport.id}`, {
        method: 'DELETE'
      })
      const data = await res.json()

      if (data.ok) {
        setMessage({
          type: 'success',
          text: `Successfully deleted import "${selectedImport.fileName}" and ${data.deletedSentences} sentences`
        })
        setDeleteModalOpen(false)
        setConfirmText('')
        setSelectedImport(null)
        await refreshImports()
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to delete import' })
      }
    } catch (error) {
      console.error('Delete import failed:', error)
      setMessage({ type: 'error', text: 'Network error' })
    } finally {
      setDeleting(false)
    }
  }, [selectedImport, confirmText, refreshImports])

  const handleSentenceUpload = useCallback(async () => {
    if (!sentenceFile) return

    setUploading(true)
    setMessage(null)

    try {
      const formData = new FormData()
      formData.append('file', sentenceFile)

      const dryRunRes = await fetch('/api/sentences/import?dryRun=true', {
        method: 'POST',
        body: formData
      })
      const dryRunData = await dryRunRes.json()

      if (!dryRunRes.ok) {
        setMessage({
          type: 'error',
          text: dryRunData.error || dryRunData.errors?.join(', ') || 'Validation failed'
        })
        setUploading(false)
        return
      }

      const formData2 = new FormData()
      formData2.append('file', sentenceFile)
      const res = await fetch('/api/sentences/import?dryRun=false', {
        method: 'POST',
        body: formData2
      })
      const data = await res.json()

      if (res.ok) {
        setMessage({
          type: 'success',
          text: `Successfully imported ${data.count || 0} sentences!`
        })
        setSentenceFile(null)
        await refreshImports()
      } else {
        setMessage({
          type: 'error',
          text: data.error || data.errors?.join(', ') || 'Import failed'
        })
      }
    } catch (error) {
      console.error('Sentence upload failed:', error)
      setMessage({ type: 'error', text: 'Network error' })
    } finally {
      setUploading(false)
    }
  }, [sentenceFile, refreshImports])

  return (
    <>
      <PageHeader title="Sentences" />
      <div className="px-8 py-8">
        <div className="mb-8">
          <p className="text-sm text-gray-600">
            Import sentences for labeling and manage import history
          </p>
        </div>

        {message && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">📊</span>
            <h2 className="text-lg font-semibold text-gray-900">Import Sentences</h2>
          </div>

          <div className="max-w-xl space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                CSV File
              </label>
              <div className="flex items-center gap-3">
                <div className="flex-1 relative">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => setSentenceFile(e.target.files?.[0] || null)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    id="sentence-file-input"
                  />
                  <div className="flex items-center gap-3 px-4 py-2.5 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors">
                    <span className="text-sm text-gray-500 truncate flex-1">
                      {sentenceFile ? sentenceFile.name : 'No file chosen'}
                    </span>
                  </div>
                </div>
                <label
                  htmlFor="sentence-file-input"
                  className="px-6 py-2.5 bg-indigo-50 text-indigo-700 font-medium rounded-lg hover:bg-indigo-100 transition-colors cursor-pointer whitespace-nowrap border border-indigo-200"
                >
                  Choose file...
                </label>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                CSV must include required columns: sentence, field_suffix (max 5), support_suffix (max 5)
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSentenceUpload}
                disabled={!sentenceFile || uploading}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
              <button
                onClick={() => setSentenceFile(null)}
                className="px-6 py-2.5 border border-gray-300 text-gray-600 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Import History</h2>
              <p className="text-sm text-gray-500 mt-1">
                Track and manage your previous sentence imports
              </p>
            </div>
            <button
              onClick={refreshImports}
              className="px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
            >
              Refresh
            </button>
          </div>

          {loadingImports ? (
            <div className="py-12 text-center text-gray-500">Loading imports...</div>
          ) : imports.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              No imports yet. Upload a CSV file to get started.
            </div>
          ) : (
            <div className="space-y-4">
              {imports.map((importRecord) => (
                <div key={importRecord.id} className="border border-gray-200 rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-gray-900">{importRecord.fileName}</h3>
                    <p className="text-sm text-gray-500">
                      Uploaded on {formatDateTime(importRecord.uploadedAt)}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      {importRecord.sentenceCount.toLocaleString()} sentences
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setSelectedImport(importRecord)
                        setDeleteModalOpen(true)
                      }}
                      className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {deleteModalOpen && selectedImport && (
        <Modal label="Delete import" onClose={() => { setDeleteModalOpen(false); setConfirmText(''); setSelectedImport(null) }} className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Delete Import</h3>
            <p className="text-sm text-gray-600 mb-4">
              Deleting the import <strong>{selectedImport.fileName}</strong> will permanently remove this import record and{' '}
              <strong>all {selectedImport.sentenceCount.toLocaleString()} sentences</strong> associated with it.
            </p>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-red-700 font-medium mb-2">This action cannot be undone.</p>
              <p className="text-sm text-red-600">
                Type <strong>DELETE</strong> below to confirm.
              </p>
            </div>

            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder='Type "DELETE" to confirm'
              className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4 focus:ring-2 focus:ring-red-500 focus:border-red-500"
            />

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setDeleteModalOpen(false)
                  setConfirmText('')
                  setSelectedImport(null)
                }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteImport}
                disabled={confirmText !== 'DELETE' || deleting}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

