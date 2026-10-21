"use client"
import { workspaceApi } from '@/lib/workspace/urls'
import { useState, useEffect } from 'react'
import PageHeader from '@/components/PageHeader'
import { formatRelativeTime, formatDate } from '@/lib/utils'
import type { CaughtError, CsvRow } from '@/lib/utils'
import Modal from '@/components/Modal'

export type Taxonomy = {
  id: string
  key: string
  description: string | null
  levelNames: Record<string, string> | null
  maxDepth: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  nodeCount: number
  annotationCount: number
  actualMaxLevel: number
  levelCounts: Array<{
    level: number
    count: number
    name: string
  }>
  lastAISyncAt?: string | null
  lastAISyncStatus?: string | null
  lastAISyncError?: string | null
  lastAISyncJobId?: string | null
  lastLearningAt?: string | null
  lastLearningJobId?: string | null
  lastLearningStatus?: string | null
  lastLearningError?: string | null
  newAnnotationsSinceLastLearning: number
}

type Props = {
  initialTaxonomies: Taxonomy[]
  initialLearningThreshold: number
}

const MAX_ACTIVE_TAXONOMIES = 3

export default function TaxonomyAdminClient({ initialTaxonomies, initialLearningThreshold }: Props) {
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>(initialTaxonomies)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [learningThreshold, setLearningThreshold] = useState(initialLearningThreshold)
  
  // Modal states
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [selectedTaxonomy, setSelectedTaxonomy] = useState<Taxonomy | null>(null)
  const [modalMessage, setModalMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form states
  const [formData, setFormData] = useState({
    key: '',
    description: '',
    maxDepth: 5,
    levelNames: {} as Record<string, string>,
    file: null as File | null
  })
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [syncingKeys, setSyncingKeys] = useState<Set<string>>(new Set())
  const [learningKeys, setLearningKeys] = useState<Set<string>>(new Set())

  // Validation states
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    ok: boolean
    message?: string
    error?: string
    errors?: Array<{ row: number; message: string }>
    recordCount?: number
  } | null>(null)
  
  // Detected max depth from CSV
  const [detectedMaxDepth, setDetectedMaxDepth] = useState<number | null>(null)

  // Poll for taxonomy updates when there are active AI sync or learning jobs
  useEffect(() => {
    const hasActiveJobs = taxonomies.some(t => 
      (t.lastAISyncStatus === 'pending' || t.lastAISyncStatus === 'processing') ||
      (t.lastLearningStatus === 'pending' || t.lastLearningStatus === 'processing')
    )
    
    if (!hasActiveJobs) return

    const interval = setInterval(() => {
      refreshTaxonomies()
    }, 5000) // Poll every 5 seconds

    return () => clearInterval(interval)
  }, [taxonomies])

  // Full load with loading spinner (for initial load & user-triggered reloads)
  async function loadTaxonomies() {
    try {
      setLoading(true)
      const res = await fetch(workspaceApi('/taxonomies'))
      const data = await res.json()
      if (data.ok) {
        if (typeof data.learningThreshold === 'number') {
          setLearningThreshold(data.learningThreshold)
        }
        setTaxonomies(data.taxonomies)
      }
    } catch (error) {
      console.error('Failed to load taxonomies:', error)
      setMessage({ type: 'error', text: 'Failed to load taxonomies' })
    } finally {
      setLoading(false)
    }
  }

  // Silent refresh — no loading spinner, used by polling
  async function refreshTaxonomies() {
    try {
      const res = await fetch(workspaceApi('/taxonomies'))
      const data = await res.json()
      if (data.ok) {
        if (typeof data.learningThreshold === 'number') {
          setLearningThreshold(data.learningThreshold)
        }
        setTaxonomies(data.taxonomies)
      }
    } catch (error) {
      console.error('Failed to refresh taxonomies:', error)
    }
  }

  // All taxonomies are active now since we use hard delete
  const activeTaxonomies = taxonomies
  const canAddNew = activeTaxonomies.length < MAX_ACTIVE_TAXONOMIES

  function openCreateModal() {
    setFormData({
      key: '',
      description: '',
      maxDepth: 5,
      levelNames: {},
      file: null
    })
    setModalMessage(null)
    setValidationResult(null)
    setDetectedMaxDepth(null)
    setCreateModalOpen(true)
  }
  
  // Detect max depth from CSV file
  async function detectMaxDepthFromFile(file: File): Promise<number | null> {
    try {
      const buffer = await file.arrayBuffer()
      const csv = new TextDecoder().decode(buffer)
      const { parse } = await import('csv-parse/sync')
      const records = parse(csv, { 
        columns: true, 
        skip_empty_lines: true, 
        bom: true,
        cast: false 
      }) as CsvRow[]
      
      if (!records || records.length === 0) {
        return null
      }
      
      // Find the maximum level value in the CSV
      let maxLevel = 0
      for (const record of records) {
        const level = record.level
        if (level != null) {
          const levelNum = parseInt(String(level).trim(), 10)
          if (!isNaN(levelNum) && levelNum > maxLevel) {
            maxLevel = levelNum
          }
        }
      }
      
      return maxLevel > 0 ? maxLevel : null
    } catch (error) {
      console.error('Error detecting max depth:', error)
      return null
    }
  }

  function openEditModal(taxonomy: Taxonomy) {
    setSelectedTaxonomy(taxonomy)
    setFormData({
      key: taxonomy.key,
      description: taxonomy.description || '',
      maxDepth: taxonomy.maxDepth,
      levelNames: taxonomy.levelNames || {},
      file: null
    })
    setEditModalOpen(true)
  }

  function openDeleteModal(taxonomy: Taxonomy) {
    setSelectedTaxonomy(taxonomy)
    setConfirmText('')
    setDeleteModalOpen(true)
  }

  async function validateFile() {
    if (!formData.file) {
      setValidationResult({
        ok: false,
        error: 'Please select a file first',
        errors: [{ row: 0, message: 'No file selected' }]
      })
      return
    }

    setValidating(true)
    setValidationResult(null)

    try {
      const formDataToSend = new FormData()
      formDataToSend.append('file', formData.file)

      const res = await fetch(workspaceApi('/taxonomies/validate'), {
        method: 'POST',
        body: formDataToSend
      })

      const data = await res.json()
      setValidationResult(data)
    } catch (caught) {
      const error = caught as CaughtError
      console.error('Validation error:', error)
      setValidationResult({
        ok: false,
        error: error.message || 'An unexpected error occurred during validation',
        errors: [{ row: 0, message: error.message || 'An unexpected error occurred during validation' }]
      })
    } finally {
      setValidating(false)
    }
  }

  async function handleCreate() {
    if (!formData.key || !formData.file) {
      setModalMessage({ type: 'error', text: 'Please fill all required fields and upload a file' })
      return
    }

    // Use detected max depth or fallback to formData.maxDepth
    const maxDepth = detectedMaxDepth || formData.maxDepth

    setSubmitting(true)
    setModalMessage(null)

    try {
      const formDataToSend = new FormData()
      formDataToSend.append('key', formData.key)
      if (formData.description) formDataToSend.append('description', formData.description)
      formDataToSend.append('maxDepth', maxDepth.toString())
      if (Object.keys(formData.levelNames).length > 0) {
        formDataToSend.append('levelNames', JSON.stringify(formData.levelNames))
      }
      formDataToSend.append('file', formData.file)

      const res = await fetch(workspaceApi('/taxonomies'), {
        method: 'POST',
        body: formDataToSend
      })

      const data = await res.json()

      if (res.ok) {
        setMessage({ type: 'success', text: `Successfully created taxonomy "${formData.key}" with ${data.importedNodes} nodes!` })
        setCreateModalOpen(false)
        setModalMessage(null)
        setValidationResult(null)
        loadTaxonomies()
      } else {
        // Format errors array if present
        let errorText = data.error || 'Failed to create taxonomy'
        if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
          const errorList = data.errors.slice(0, 20).map((e: { row: number; message: string }) => `Row ${e.row}: ${e.message}`).join('\n')
          const moreErrors = data.errors.length > 20 ? `\n... and ${data.errors.length - 20} more errors` : ''
          errorText = `${errorText}\n\n${errorList}${moreErrors}`
        }
        // Show error in modal so user doesn't lose form data
        setModalMessage({ type: 'error', text: errorText })
      }
    } catch {
      setModalMessage({ type: 'error', text: 'Network error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleEdit(confirmOrphans = false) {
    if (!selectedTaxonomy) return

    setSubmitting(true)
    setMessage(null)

    try {
      const formDataToSend = new FormData()
      formDataToSend.append('description', formData.description)
      formDataToSend.append('levelNames', JSON.stringify(formData.levelNames))
      if (formData.file) {
        formDataToSend.append('file', formData.file)
      }
      if (confirmOrphans) {
        formDataToSend.append('confirmOrphans', 'true')
      }

      const res = await fetch(workspaceApi(`/taxonomies/${selectedTaxonomy.key}`), {
        method: 'PUT',
        body: formDataToSend
      })

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
        setMessage({ type: 'success', text: `Successfully updated taxonomy "${selectedTaxonomy.key}"${nodesMsg}!` })
        setEditModalOpen(false)
        loadTaxonomies()
      } else {
        // Format errors array if present
        let errorText = data.error || 'Failed to update taxonomy'
        if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
          const errorList = data.errors.slice(0, 20).map((e: { row: number; message: string }) => `Row ${e.row}: ${e.message}`).join('\n')
          const moreErrors = data.errors.length > 20 ? `\n... and ${data.errors.length - 20} more errors` : ''
          errorText = `${errorText}\n\n${errorList}${moreErrors}`
        }
        setMessage({ type: 'error', text: errorText })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!selectedTaxonomy || confirmText !== 'DELETE') return

    setSubmitting(true)
    setMessage(null)

    try {
      const res = await fetch(workspaceApi(`/taxonomies/${selectedTaxonomy.key}`), {
        method: 'DELETE'
      })

      const data = await res.json()

      if (res.ok) {
        const deletedInfo = data.deleted ? 
          `Deleted ${data.deleted.nodes} nodes, ${data.deleted.annotations} annotations, ${data.deleted.aiSuggestions} AI suggestions, and ${data.deleted.synonyms} synonyms.` :
          'Taxonomy and all associated data deleted successfully.'
        setMessage({ type: 'success', text: `Successfully deleted taxonomy "${selectedTaxonomy.key}". ${deletedInfo}` })
        setDeleteModalOpen(false)
        setSelectedTaxonomy(null)
        loadTaxonomies()
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to delete taxonomy' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' })
    } finally {
      setSubmitting(false)
    }
  }

  function updateLevelName(level: number, name: string) {
    setFormData(prev => ({
      ...prev,
      levelNames: {
        ...prev.levelNames,
        [level.toString()]: name
      }
    }))
  }

  function isSyncing(key: string) {
    return syncingKeys.has(key)
  }

  function isLearning(key: string) {
    return learningKeys.has(key)
  }

  function isSyncedWithAI(taxonomy: Taxonomy) {
    return taxonomy.lastAISyncStatus === 'completed'
  }

  async function handleSyncAI(taxonomy: Taxonomy) {
    try {
      setSyncingKeys(prev => new Set(prev).add(taxonomy.key))
      setMessage(null)
      const res = await fetch(workspaceApi(`/taxonomies/${taxonomy.key}/sync-ai`), {
        method: 'POST'
      })
      const data = await res.json()
      if (res.ok) {
        setMessage({ type: 'success', text: `AI sync started for "${taxonomy.key}" (job ${data.jobId})` })
        // Refresh silently after a short delay
        setTimeout(() => refreshTaxonomies(), 500)
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to start AI sync' })
      }
    } catch (error) {
      console.error('AI sync error:', error)
      setMessage({ type: 'error', text: 'Network error while starting AI sync' })
    } finally {
      setSyncingKeys(prev => {
        const next = new Set(prev)
        next.delete(taxonomy.key)
        return next
      })
    }
  }

  async function handleLearning(taxonomy: Taxonomy) {
    try {
      setLearningKeys(prev => new Set(prev).add(taxonomy.key))
      setMessage(null)
      const res = await fetch(workspaceApi('/ai-labeling/learn'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxonomyKey: taxonomy.key })
      })
      const data = await res.json()
      if (res.ok) {
        setMessage({
          type: 'success',
          text: `Created ${data.totalJobs} learning job(s) for "${taxonomy.key}" (${data.totalSentences} sentences). Track progress in the AI jobs badge.`
        })
        setTimeout(() => refreshTaxonomies(), 500)
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to start learning job' })
      }
    } catch (error) {
      console.error('Learning job error:', error)
      setMessage({ type: 'error', text: 'Network error while starting learning job' })
    } finally {
      setLearningKeys(prev => {
        const next = new Set(prev)
        next.delete(taxonomy.key)
        return next
      })
    }
  }

  function renderStatusBadge(status?: string | null) {
    if (!status) return null
    const normalized = status.toLowerCase()
    const styles =
      normalized === 'success' || normalized === 'completed' || normalized === 'deleted'
        ? 'bg-green-100 text-green-800'
        : normalized === 'processing'
        ? 'bg-indigo-100 text-indigo-800'
        : normalized === 'pending' || normalized === 'deleting'
        ? 'bg-yellow-100 text-yellow-800'
        : normalized === 'failed' || normalized === 'delete_failed'
        ? 'bg-red-100 text-red-800'
        : 'bg-gray-100 text-gray-800'
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles}`}>
        {status.replaceAll('_', ' ')}
      </span>
    )
  }


  return (
    <>
      <PageHeader title="Taxonomies" />
      
      <div className="px-8 py-8">
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm text-gray-600">
                Import and manage hierarchical taxonomies for labeling (max {MAX_ACTIVE_TAXONOMIES} active)
              </p>
              {!canAddNew && (
                <p className="text-sm text-orange-600 mt-2">
                  ⚠️ Maximum active taxonomies reached. Delete one to add a new taxonomy.
                </p>
              )}
            </div>
            <button
              onClick={openCreateModal}
              disabled={!canAddNew || loading}
              className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add New Taxonomy
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' 
              ? 'bg-green-50 text-green-800 border border-green-200' 
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            <div className="whitespace-pre-wrap text-sm max-h-60 overflow-y-auto">
              {message.text}
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Loading taxonomies...</p>
        ) : (
          <>
            {/* Active Taxonomies */}
            <div className="space-y-6 mb-12">
              {activeTaxonomies.length === 0 ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                  <p className="text-gray-600">No active taxonomies. Click &quot;Add New Taxonomy&quot; to create one.</p>
                </div>
              ) : (
                activeTaxonomies.map(taxonomy => (
                  <div key={taxonomy.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-4 flex-wrap">
                            <h2 className="text-lg font-semibold text-gray-900">{taxonomy.key}</h2>
                            <span className="text-sm text-gray-500">
                              {(taxonomy.nodeCount ?? 0).toLocaleString()} nodes
                            </span>
                            <span className="text-sm text-gray-500">
                              {taxonomy.actualMaxLevel ?? 0} levels
                            </span>
                            <span className="text-sm text-gray-500">
                              Created {formatDate(taxonomy.createdAt)}
                            </span>
                          </div>
                          {taxonomy.description && (
                            <p className="text-sm text-gray-600 mt-1">{taxonomy.description}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => openEditModal(taxonomy)}
                            className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => openDeleteModal(taxonomy)}
                            className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="p-6">
                      {/* AI Actions - Simplified */}
                      <div className="flex gap-4 flex-wrap">
                        {/* AI Sync */}
                        <div className="flex flex-col">
                          <button
                            onClick={() => handleSyncAI(taxonomy)}
                            disabled={isSyncing(taxonomy.key)}
                            className="px-4 py-2.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                          >
                            {isSyncing(taxonomy.key) ? 'Syncing…' : 'Sync taxonomy with AI'}
                          </button>
                          <div className="mt-2 text-center">
                            {renderStatusBadge(taxonomy.lastAISyncStatus)}
                            <p className="text-xs text-gray-500 mt-1">
                              {taxonomy.lastAISyncAt ? formatRelativeTime(taxonomy.lastAISyncAt) : 'Never synced'}
                            </p>
                          </div>
                        </div>

                        {/* AI Learning */}
                        <div className="flex flex-col">
                          <button
                            onClick={() => handleLearning(taxonomy)}
                            disabled={
                              !isSyncedWithAI(taxonomy) ||
                              isLearning(taxonomy.key) ||
                              taxonomy.newAnnotationsSinceLastLearning < learningThreshold
                            }
                            className="px-4 py-2.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                          >
                            {isLearning(taxonomy.key) ? 'Sending…' : 'Train AI with submitted labels'}
                          </button>
                          <div className="mt-2 text-center">
                            {renderStatusBadge(taxonomy.lastLearningStatus)}
                            <p className="text-xs text-gray-500 mt-1">
                              {taxonomy.lastLearningAt ? formatRelativeTime(taxonomy.lastLearningAt) : 'Never trained'}
                              {' '}
                              <strong>{(taxonomy.newAnnotationsSinceLastLearning ?? 0).toLocaleString()}</strong> / {learningThreshold.toLocaleString()} new annotations
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

          </>
        )}
      </div>

      {/* Create Modal */}
      {createModalOpen && (
        <Modal label="Create new taxonomy" onClose={() => { setCreateModalOpen(false); setValidationResult(null) }} className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Create New Taxonomy</h2>
              <button
                onClick={() => {
                  setCreateModalOpen(false)
                  setValidationResult(null)
                }}
                className="text-gray-500 hover:text-gray-700 text-2xl"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Key (short name) *
                </label>
                <input
                  type="text"
                  value={formData.key}
                  onChange={e => setFormData({...formData, key: e.target.value.toUpperCase()})}
                  placeholder="e.g. ISCO"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">ℹ️ Unique identifier, cannot be changed later</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description (optional)
                </label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Used for job classification worldwide..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  CSV File *
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <input
                      type="file"
                      accept=".csv"
                      onChange={async (e) => {
                        const newFile = e.target.files?.[0] || null
                        
                        // Always update file immediately
                        setFormData(prev => ({ 
                          ...prev, 
                          file: newFile || null
                        }))
                        
                        // Clear validation results when file changes
                        setValidationResult(null)
                        
                        // Detect max depth from the CSV file (async, doesn't block file setting)
                        if (newFile) {
                          detectMaxDepthFromFile(newFile).then(maxDepth => {
                            setDetectedMaxDepth(maxDepth)
                            if (maxDepth) {
                              // Update formData.maxDepth to match detected depth
                              setFormData(prev => ({ 
                                ...prev, 
                                maxDepth: maxDepth 
                              }))
                            }
                          }).catch(err => {
                            console.error('Error detecting max depth:', err)
                          })
                        } else {
                          setDetectedMaxDepth(null)
                          setFormData(prev => ({ 
                            ...prev, 
                            maxDepth: 5 
                          }))
                        }
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      id="create-file-input"
                    />
                    <div className="flex items-center gap-3 px-4 py-2.5 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors">
                      <span className="text-sm text-gray-500 truncate flex-1">
                        {formData.file ? formData.file.name : 'No file chosen'}
                      </span>
                    </div>
                  </div>
                  <label
                    htmlFor="create-file-input"
                    className="px-6 py-2.5 bg-indigo-50 text-indigo-700 font-medium rounded-lg hover:bg-indigo-100 transition-colors cursor-pointer whitespace-nowrap border border-indigo-200"
                  >
                    Choose file...
                  </label>
                  {formData.file && (
                    <button
                      onClick={validateFile}
                      disabled={validating}
                      className="px-6 py-2.5 bg-gray-600 text-white font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                    >
                      {validating ? 'Validating...' : 'Validate File'}
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  ℹ️ Required: id, label, parent_id, level | Optional: definition, examples, synonyms
                </p>
                {detectedMaxDepth && (
                  <p className="text-xs text-indigo-600 mt-1">
                    ✓ Detected maximum depth: {detectedMaxDepth} level{detectedMaxDepth > 1 ? 's' : ''}
                  </p>
                )}
                
                {/* Validation Results */}
                {validationResult && (
                  <div className={`mt-3 p-4 rounded-lg text-sm ${
                    validationResult.ok
                      ? 'bg-green-50 text-green-800 border border-green-200'
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}>
                    <div className="flex items-start gap-2">
                      <span className="text-lg flex-shrink-0">
                        {validationResult.ok ? '✅' : '⚠️'}
                      </span>
                      <div className="flex-1">
                        <p className="font-medium mb-1">
                          {validationResult.ok ? 'Validation Passed' : 'Validation Failed'}
                        </p>
                        {validationResult.ok ? (
                          <p>{validationResult.message || `File is valid! Found ${validationResult.recordCount || 0} records.`}</p>
                        ) : (
                          <div className="break-words whitespace-pre-wrap text-sm max-h-60 overflow-y-auto">
                            {validationResult.error && (
                              <p className="mb-2">{validationResult.error}</p>
                            )}
                            {validationResult.errors && validationResult.errors.length > 0 && (
                              <div className="mt-2">
                                <p className="font-medium mb-1">Errors:</p>
                                <ul className="list-disc list-inside space-y-1">
                                  {validationResult.errors.slice(0, 20).map((err, idx) => (
                                    <li key={idx}>Row {err.row}: {err.message}</li>
                                  ))}
                                  {validationResult.errors.length > 20 && (
                                    <li className="text-gray-600">... and {validationResult.errors.length - 20} more errors</li>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Level Names (optional)
                </label>
                <div className="space-y-2">
                  {Array.from({ length: detectedMaxDepth || formData.maxDepth }, (_, i) => i + 1).map(level => (
                    <div key={level} className="flex items-center gap-2">
                      <span className="text-sm text-gray-600 w-16">Level {level}:</span>
                      <input
                        type="text"
                        value={formData.levelNames[level.toString()] || ''}
                        onChange={e => updateLevelName(level, e.target.value)}
                        placeholder={`Level ${level}`}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                      />
                    </div>
                  ))}
                </div>
                {!detectedMaxDepth && !formData.file && (
                  <p className="text-xs text-gray-500 mt-2">
                    ℹ️ Upload a CSV file to automatically detect the maximum depth
                  </p>
                )}
              </div>

              {/* Modal Error Message - Below file chooser */}
              {modalMessage && (
                <div className={`p-4 rounded-lg text-sm ${
                  modalMessage.type === 'success' 
                    ? 'bg-green-50 text-green-800 border border-green-200' 
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  <div className="flex items-start gap-2">
                    <span className="text-lg flex-shrink-0">
                      {modalMessage.type === 'error' ? '⚠️' : '✅'}
                    </span>
                    <div className="flex-1">
                      <p className="font-medium mb-1">
                        {modalMessage.type === 'error' ? 'Import Error' : 'Success'}
                      </p>
                      <div className="break-words whitespace-pre-wrap text-sm max-h-60 overflow-y-auto">
                        {modalMessage.text}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t border-gray-200">
              <button
                onClick={() => {
                  setCreateModalOpen(false)
                  setValidationResult(null)
                }}
                disabled={submitting}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting || !formData.key || !formData.file || (validationResult !== null && !validationResult.ok)}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Creating...' : 'Create & Import'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editModalOpen && selectedTaxonomy && (
        <Modal label={`Edit taxonomy ${selectedTaxonomy.key}`} onClose={() => setEditModalOpen(false)} className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Edit Taxonomy: {selectedTaxonomy.key}</h2>
              <button
                onClick={() => setEditModalOpen(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">
                  Key (cannot be changed)
                </label>
                <input
                  type="text"
                  value={formData.key}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Maximum Depth (current: {selectedTaxonomy.maxDepth})
                </label>
                <select
                  value={formData.maxDepth}
                  onChange={e => setFormData({...formData, maxDepth: parseInt(e.target.value)})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                >
                  {[1, 2, 3, 4, 5].map(d => (
                    <option key={d} value={d}>{d} level{d > 1 ? 's' : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Level Names
                </label>
                <div className="space-y-2">
                  {Array.from({ length: formData.maxDepth }, (_, i) => i + 1).map(level => (
                    <div key={level} className="flex items-center gap-2">
                      <span className="text-sm text-gray-600 w-16">Level {level}:</span>
                      <input
                        type="text"
                        value={formData.levelNames[level.toString()] || ''}
                        onChange={e => updateLevelName(level, e.target.value)}
                        placeholder={`Level ${level}`}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-orange-800 mb-2">⚠️ Update Nodes (optional)</h4>
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1 relative">
                    <input
                      type="file"
                      accept=".csv"
                      onChange={e => setFormData({...formData, file: e.target.files?.[0] || null})}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      id="edit-file-input"
                    />
                    <div className="flex items-center gap-3 px-4 py-2.5 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors">
                      <span className="text-sm text-gray-500 truncate flex-1">
                        {formData.file ? formData.file.name : 'No file chosen'}
                      </span>
                    </div>
                  </div>
                  <label
                    htmlFor="edit-file-input"
                    className="px-6 py-2.5 bg-indigo-50 text-indigo-700 font-medium rounded-lg hover:bg-indigo-100 transition-colors cursor-pointer whitespace-nowrap border border-indigo-200"
                  >
                    Choose file...
                  </label>
                </div>
                <p className="text-xs text-orange-700">
                  ⚠️ WARNING: This will REPLACE all existing nodes with the uploaded CSV
                </p>
              </div>
            </div>

            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t border-gray-200">
              <button
                onClick={() => setEditModalOpen(false)}
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
      )}

      {/* Delete Modal */}
      {deleteModalOpen && selectedTaxonomy && (
        <Modal label="Delete taxonomy" onClose={() => { if (!submitting) { setDeleteModalOpen(false); setConfirmText('') } }} className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-red-600">⚠️ Danger Zone</h3>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-gray-700">You are about to delete taxonomy:</p>
              <p className="font-semibold text-gray-900">&quot;{selectedTaxonomy.key}&quot;</p>
              
              <div className="text-sm text-gray-600 space-y-1">
                <p>This will:</p>
                <ul className="list-disc list-inside pl-2">
                  <li>Permanently delete the taxonomy and all associated data</li>
                  <li>Delete {selectedTaxonomy.nodeCount} nodes and {selectedTaxonomy.annotationCount} annotations</li>
                  <li>Delete all AI suggestions for this taxonomy</li>
                  <li>This action cannot be undone</li>
                </ul>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Type <code className="bg-gray-100 px-2 py-1 rounded text-red-600 font-mono">DELETE</code> to confirm:
                </label>
                <input
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
                onClick={() => {
                  setDeleteModalOpen(false)
                  setConfirmText('')
                }}
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
      )}
    </>
  )
}
