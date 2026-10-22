'use client'
import { workspaceApi } from '@/lib/workspace/urls'
import { useState } from 'react'
import PageHeader from '@/components/PageHeader'
import { buttonClass, panelClass } from '@/components/ui/styles'

export default function ExportAdminPage() {
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    try {
      setExporting(true)
      setMessage(null)

      const params = new URLSearchParams()
      if (statusFilter !== 'all') {
        params.append('status', statusFilter)
      }

      const url = workspaceApi(`/export${params.toString() ? '?' + params.toString() : ''}`)
      const res = await fetch(url)

      if (res.ok) {
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `export-${new Date().toISOString()}.csv`
        a.click()
        // Revoking at once can leave the browser saving an empty file.
        setTimeout(() => window.URL.revokeObjectURL(url), 60_000)
        setMessage({ type: 'success', text: 'Export downloaded successfully!' })
      } else {
        const error = await res.json().catch(() => ({ error: 'Export failed' }))
        setMessage({ type: 'error', text: error.error || 'Export failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Export failed' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader title="Export data" />
      <div className="px-8 py-8">
        <div className="mb-8">
          <p className="text-sm text-gray-600">
            Export labeled sentences with annotations, AI suggestions, and metadata
          </p>
        </div>

        {/* Message */}
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

        {/* Export Data */}
        <div className={`${panelClass} p-6`}>
          <div className="flex items-center gap-2 mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Export labeled data</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-end gap-4">
              <div className="w-64">
                <label htmlFor="export-status" className="block text-sm font-medium text-gray-700 mb-2">
                  Status filter
                </label>
                <select
                  id="export-status"
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-500 rounded-lg text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <option value="all">All</option>
                  <option value="submitted">Submitted only</option>
                  <option value="pending">Pending only</option>
                  <option value="skipped">Skipped only</option>
                </select>
              </div>

              <button onClick={handleExport} disabled={exporting} className={buttonClass('primary')}>
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Export format</h3>
            <p className="text-xs text-gray-600">
              The exported CSV includes: sentence ID, original field columns (field_FIELD_NAME format), support columns,
              labeled taxonomies ({'{taxonomyKey}'}_1, {'{taxonomyKey}'}_2, etc.), AI suggestions ({'{taxonomyKey}'}
              _ai1, {'{taxonomyKey}'}_ai2 with confidence scores), status, flagged, last_editor, last_edited, and
              comments.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
