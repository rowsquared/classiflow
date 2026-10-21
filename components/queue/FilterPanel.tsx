'use client'
import { workspaceApi } from '@/lib/workspace/urls'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { UNKNOWN_NODE_CODES } from '@/lib/constants'

export type QueueFilters = {
  status: string[]
  userId: string | null
  userScope: 'all' | 'me' | 'specific'
  assignedToUserId: string | null
  lastEditorId: string | null
  dateRange: {
    from: string | null
    to: string | null
  }
  taxonomyKey: string | null
  level: string | null
  code: string | null
  source: 'all' | 'ai' | 'user' | null
  aiTaxonomyKey: string | null
  aiLevel: string | null
  aiCode: string | null
  aiConfidenceMin: string | null
  aiConfidenceMax: string | null
  flagged: boolean | null
  hasComments: boolean | null
  hasSubmittedLabels: boolean | null
  hasAISuggestions: boolean | null
  importId: string | null
  supportFilters: Record<string, string>
}

export const countActiveFilters = (filters: QueueFilters): number => {
  return (
    (filters.flagged !== null ? 1 : 0) +
    (filters.hasComments !== null ? 1 : 0) +
    (filters.assignedToUserId ? 1 : 0) +
    (filters.lastEditorId ? 1 : 0) +
    (filters.dateRange.from || filters.dateRange.to ? 1 : 0) +
    (filters.taxonomyKey ? 1 : 0) +
    (filters.code ? 1 : 0) +
    (filters.aiTaxonomyKey ? 1 : 0) +
    (filters.aiCode ? 1 : 0) +
    (filters.aiConfidenceMin !== null ? 1 : 0) +
    (filters.aiConfidenceMax !== null ? 1 : 0) +
    (filters.hasSubmittedLabels !== null ? 1 : 0) +
    (filters.hasAISuggestions !== null ? 1 : 0) +
    (filters.importId ? 1 : 0) +
    (filters.status.length ? 1 : 0) +
    Object.keys(filters.supportFilters).filter(k => filters.supportFilters[k]).length
  )
}

interface FilterPanelProps {
  collapsed: boolean
  onToggle: () => void
  filters: QueueFilters
  onApply: (filters: QueueFilters) => void
  onReset: () => void
  taxonomies: Array<{ key: string; levelNames?: Record<string, string> | null }>
  users?: Array<{ id: string; username: string; name: string | null }>
  showAssignedToFilter?: boolean
}

type NodeOption = {
  code: string
  label: string
  level: number
}

type ImportFile = {
  id: string
  fileName: string
  uploadedAt: string
  totalRows: number
  sentenceCount: number
}

export default function FilterPanel({
  collapsed,
  onToggle,
  filters,
  onApply,
  onReset,
  taxonomies,
  users = [],
  showAssignedToFilter = false
}: FilterPanelProps) {
  const [localFilters, setLocalFilters] = useState<QueueFilters>({
    ...filters,
    lastEditorId: filters.lastEditorId || null
  })
  const [imports, setImports] = useState<ImportFile[]>([])
  const [loadingImports, setLoadingImports] = useState(false)

  useEffect(() => {
    setLocalFilters({
      ...filters,
      lastEditorId: filters.lastEditorId || null
    })
  }, [filters])

  // Fetch imports on mount
  useEffect(() => {
    const fetchImports = async () => {
      try {
        setLoadingImports(true)
        const res = await fetch(workspaceApi('/imports'))
        const data = await res.json()
        if (data.ok && data.imports) {
          setImports(data.imports)
        }
      } catch (error) {
        console.error('Failed to fetch imports:', error)
      } finally {
        setLoadingImports(false)
      }
    }
    fetchImports()
  }, [])
  const unknownOptions = useMemo(() => {
    return Object.entries(UNKNOWN_NODE_CODES).map(([lvl, code]) => {
      const levelNumber = Number(lvl)
      return {
        code,
        label: 'Unknown',
        level: levelNumber
      }
    })
  }, [])
  const [submittedLabelQuery, setSubmittedLabelQuery] = useState('')
  const [submittedLabelResults, setSubmittedLabelResults] = useState<NodeOption[]>([])
  const [submittedLabelLoading, setSubmittedLabelLoading] = useState(false)
  const [selectedLabelDisplay, setSelectedLabelDisplay] = useState('')
  const submittedLabelAbort = useRef<AbortController | null>(null)
  const [isSubmittedDropdownOpen, setIsSubmittedDropdownOpen] = useState(false)
  const [aiLabelQuery, setAiLabelQuery] = useState('')
  const [aiLabelResults, setAiLabelResults] = useState<NodeOption[]>([])
  const [aiLabelLoading, setAiLabelLoading] = useState(false)
  const [selectedAiLabelDisplay, setSelectedAiLabelDisplay] = useState('')
  const aiLabelSearchAbort = useRef<AbortController | null>(null)
  const [isAiDropdownOpen, setIsAiDropdownOpen] = useState(false)
  const fieldBaseClasses =
    'w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed'
  const getFieldClasses = (active: boolean) =>
    active ? 'border-teal-500 bg-[#e6fbf8] focus:ring-teal-500' : 'border-gray-300 focus:ring-indigo-500'
  const getUnknownMatches = useCallback(
    (query: string) => {
      if (!query) return unknownOptions
      const normalized = query.toLowerCase()
      return unknownOptions.filter(
        option => option.label.toLowerCase().includes(normalized) || option.code.toLowerCase().includes(normalized)
      )
    },
    [unknownOptions]
  )
  useEffect(() => {
    if (!localFilters.taxonomyKey || !isSubmittedDropdownOpen) {
      submittedLabelAbort.current?.abort()
      setSubmittedLabelResults([])
      setSubmittedLabelLoading(false)
      return
    }
    const query = submittedLabelQuery.trim()
    submittedLabelAbort.current?.abort()
    const controller = new AbortController()
    submittedLabelAbort.current = controller
    setSubmittedLabelLoading(true)
    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams()
        if (query) params.set('q', query)
        const queryString = params.toString()
        const url = queryString
          ? workspaceApi(`/taxonomies/${localFilters.taxonomyKey}/nodes?${queryString}`)
          : workspaceApi(`/taxonomies/${localFilters.taxonomyKey}/nodes`)
        const res = await fetch(url, {
          signal: controller.signal
        })
        if (!res.ok) throw new Error('Failed to search submitted labels')
        const data = await res.json()
        const fetched: NodeOption[] = (data.items || []).map(
          (item: { code: string; label: string; level: number }) => ({
            code: item.code,
            label: item.label,
            level: item.level
          })
        )
        if (!controller.signal.aborted) {
          const unknownMatches = getUnknownMatches(query)
          setSubmittedLabelResults([...fetched, ...unknownMatches])
        }
      } catch (error) {
        if (controller.signal.aborted) return
        console.error('Failed to search submitted labels:', error)
        setSubmittedLabelResults(getUnknownMatches(query))
      } finally {
        if (!controller.signal.aborted) {
          setSubmittedLabelLoading(false)
        }
      }
    }, 200)
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [submittedLabelQuery, localFilters.taxonomyKey, isSubmittedDropdownOpen, getUnknownMatches])

  useEffect(() => {
    if (!localFilters.aiTaxonomyKey || !isAiDropdownOpen) {
      aiLabelSearchAbort.current?.abort()
      setAiLabelResults([])
      setAiLabelLoading(false)
      return
    }
    const query = aiLabelQuery.trim()
    aiLabelSearchAbort.current?.abort()
    const controller = new AbortController()
    aiLabelSearchAbort.current = controller
    setAiLabelLoading(true)
    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams()
        if (query) params.set('q', query)
        const queryString = params.toString()
        const url = queryString
          ? workspaceApi(`/taxonomies/${localFilters.aiTaxonomyKey}/nodes?${queryString}`)
          : workspaceApi(`/taxonomies/${localFilters.aiTaxonomyKey}/nodes`)
        const res = await fetch(url, {
          signal: controller.signal
        })
        if (!res.ok) throw new Error('Failed to search AI labels')
        const data = await res.json()
        const fetched: NodeOption[] = (data.items || []).map(
          (item: { code: string; label: string; level: number }) => ({
            code: item.code,
            label: item.label,
            level: item.level
          })
        )
        if (!controller.signal.aborted) {
          const unknownMatches = getUnknownMatches(query)
          setAiLabelResults([...fetched, ...unknownMatches])
        }
      } catch (error) {
        if (controller.signal.aborted) return
        console.error('Failed to search AI labels:', error)
        setAiLabelResults(getUnknownMatches(query))
      } finally {
        if (!controller.signal.aborted) {
          setAiLabelLoading(false)
        }
      }
    }, 200)
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [aiLabelQuery, localFilters.aiTaxonomyKey, isAiDropdownOpen, getUnknownMatches])

  const handleSubmittedLabelSelect = (option: NodeOption) => {
    setLocalFilters(prev => ({
      ...prev,
      code: option.code
    }))
    setSelectedLabelDisplay(`${option.code} — ${option.label}`)
    setSubmittedLabelQuery('')
    setSubmittedLabelResults([])
    setIsSubmittedDropdownOpen(false)
  }

  const handleAiLabelSelect = (option: NodeOption) => {
    setLocalFilters(prev => ({
      ...prev,
      aiCode: option.code
    }))
    setSelectedAiLabelDisplay(`${option.code} — ${option.label}`)
    setAiLabelQuery('')
    setAiLabelResults([])
    setIsAiDropdownOpen(false)
  }

  const clearSubmittedLabel = () => {
    setLocalFilters(prev => ({ ...prev, code: null }))
    setSelectedLabelDisplay('')
    setSubmittedLabelQuery('')
    setSubmittedLabelResults([])
    setSubmittedLabelLoading(false)
    setIsSubmittedDropdownOpen(false)
  }

  const clearAiLabel = () => {
    setLocalFilters(prev => ({ ...prev, aiCode: null }))
    setSelectedAiLabelDisplay('')
    setAiLabelQuery('')
    setAiLabelResults([])
    setAiLabelLoading(false)
    setIsAiDropdownOpen(false)
  }

  const handleConfidenceChange = (field: 'aiConfidenceMin' | 'aiConfidenceMax', value: string) => {
    if (value === '') {
      setLocalFilters(prev => ({ ...prev, [field]: null }))
      return
    }
    const parsed = parseFloat(value)
    if (Number.isNaN(parsed)) {
      return
    }
    const clamped = Math.min(Math.max(parsed, 0), 1)
    setLocalFilters(prev => ({ ...prev, [field]: clamped.toString() }))
  }

  const handleApply = () => {
    onApply(localFilters)
  }

  const handleReset = () => {
    const emptyFilters: QueueFilters = {
      status: [],
      userId: null,
      userScope: 'all',
      assignedToUserId: null,
      lastEditorId: null,
      dateRange: { from: null, to: null },
      taxonomyKey: null,
      level: null,
      code: null,
      source: null,
      aiTaxonomyKey: null,
      aiLevel: null,
      aiCode: null,
      aiConfidenceMin: null,
      aiConfidenceMax: null,
      flagged: null,
      hasComments: null,
      hasSubmittedLabels: null,
      hasAISuggestions: null,
      importId: null,
      supportFilters: {}
    }
    setLocalFilters(emptyFilters)
    onReset()
    setSubmittedLabelQuery('')
    setSubmittedLabelResults([])
    setSelectedLabelDisplay('')
    setAiLabelQuery('')
    setAiLabelResults([])
    setIsSubmittedDropdownOpen(false)
    setIsAiDropdownOpen(false)
    setSelectedAiLabelDisplay('')
  }

  // Count active filters
  const activeFilterCount = countActiveFilters(filters)

  if (collapsed) {
    return null
  }

  return (
    <div className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between min-h-[76px]">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-900">Filters</h2>
          {activeFilterCount > 0 && (
            <span className="px-2 py-0.5 bg-indigo-600 text-white text-xs font-medium rounded-full">
              {activeFilterCount}
            </span>
          )}
        </div>
        <button onClick={onToggle} className="p-1 hover:bg-gray-200 rounded transition-colors" title="Hide filters">
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {/* Filter Sections */}
      <div className="flex-1 p-4 space-y-6 overflow-y-auto">
        {/* Flags & Comments */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">Flags & Comments</h3>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={localFilters.flagged === true}
                onChange={e =>
                  setLocalFilters(prev => ({
                    ...prev,
                    flagged: e.target.checked ? true : null
                  }))
                }
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700 flex items-center gap-1">
                <svg className="w-4 h-4 text-[#F56476]" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 2.2 L5.4 13.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path
                    d="M5 3
                       C 8 1.5 10.5 3.5 13 2.5
                       L 13 10
                       C 10.5 11 8 9.5 5 10.5
                       Z"
                    fill="currentColor"
                  />
                </svg>
                Flagged
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={localFilters.hasComments === true}
                onChange={e =>
                  setLocalFilters(prev => ({
                    ...prev,
                    hasComments: e.target.checked ? true : null
                  }))
                }
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700 flex items-center gap-1">
                <svg
                  className="w-4 h-4 text-[#A7ACD9]"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M3 3h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6l-3 3v-9a1 1 0 0 1 1-1z" />
                </svg>
                Has comments
              </span>
            </label>
          </div>
        </div>

        {/* Assigned To */}
        {showAssignedToFilter && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Assigned To</h3>
            <select
              value={localFilters.assignedToUserId || ''}
              onChange={e =>
                setLocalFilters(prev => ({
                  ...prev,
                  assignedToUserId: e.target.value || null
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All users</option>
              <option value="unassigned">Unassigned</option>
              {users.length > 0 &&
                users.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.username}
                  </option>
                ))}
            </select>
          </div>
        )}

        {/* Last Editor */}
        {users.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Last Editor</h3>
            <select
              value={localFilters.lastEditorId || ''}
              onChange={e =>
                setLocalFilters(prev => ({
                  ...prev,
                  lastEditorId: e.target.value || null
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All editors</option>
              {users.map(user => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Import File */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">Import File</h3>
          <select
            value={localFilters.importId || ''}
            onChange={e =>
              setLocalFilters(prev => ({
                ...prev,
                importId: e.target.value || null
              }))
            }
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${getFieldClasses(Boolean(localFilters.importId))}`}
            disabled={loadingImports}
          >
            <option value="">All imports</option>
            {imports.map(imp => (
              <option key={imp.id} value={imp.id}>
                {imp.fileName} ({imp.sentenceCount.toLocaleString()} sentences)
              </option>
            ))}
          </select>
        </div>

        {/* Date Range */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">Last Edited</h3>
          <div className="space-y-2">
            {/* Quick preset buttons */}
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => {
                  const today = new Date()
                  const todayStr = today.toISOString().split('T')[0]
                  setLocalFilters(prev => ({
                    ...prev,
                    dateRange: { from: todayStr, to: todayStr }
                  }))
                }}
                className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Today
              </button>
              <button
                onClick={() => {
                  const today = new Date()
                  const weekAgo = new Date(today)
                  weekAgo.setDate(today.getDate() - 7)
                  setLocalFilters(prev => ({
                    ...prev,
                    dateRange: {
                      from: weekAgo.toISOString().split('T')[0],
                      to: today.toISOString().split('T')[0]
                    }
                  }))
                }}
                className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Last 7d
              </button>
              <button
                onClick={() => {
                  const today = new Date()
                  const monthAgo = new Date(today)
                  monthAgo.setDate(today.getDate() - 30)
                  setLocalFilters(prev => ({
                    ...prev,
                    dateRange: {
                      from: monthAgo.toISOString().split('T')[0],
                      to: today.toISOString().split('T')[0]
                    }
                  }))
                }}
                className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Last 30d
              </button>
              <button
                onClick={() => {
                  setLocalFilters(prev => ({
                    ...prev,
                    dateRange: { from: null, to: null }
                  }))
                }}
                className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 transition-colors text-gray-600"
              >
                Clear
              </button>
            </div>

            {/* Custom date range */}
            <div className="pt-2 border-t border-gray-200">
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-gray-600 block mb-1">From</label>
                  <input
                    type="date"
                    value={localFilters.dateRange.from || ''}
                    onChange={e =>
                      setLocalFilters(prev => ({
                        ...prev,
                        dateRange: { ...prev.dateRange, from: e.target.value || null }
                      }))
                    }
                    className={`${fieldBaseClasses} py-1.5 ${getFieldClasses(Boolean(localFilters.dateRange.from))}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600 block mb-1">To</label>
                  <input
                    type="date"
                    value={localFilters.dateRange.to || ''}
                    onChange={e =>
                      setLocalFilters(prev => ({
                        ...prev,
                        dateRange: { ...prev.dateRange, to: e.target.value || null }
                      }))
                    }
                    className={`${fieldBaseClasses} py-1.5 ${getFieldClasses(Boolean(localFilters.dateRange.to))}`}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Taxonomy/Labels */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">Submitted Labels</h3>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-gray-600">Taxonomy</label>
              <select
                value={localFilters.taxonomyKey || ''}
                onChange={e => {
                  const value = e.target.value || null
                  setLocalFilters(prev => ({
                    ...prev,
                    taxonomyKey: value,
                    level: null,
                    code: null
                  }))
                  setSubmittedLabelQuery('')
                  setSubmittedLabelResults([])
                  setSelectedLabelDisplay('')
                  setIsSubmittedDropdownOpen(false)
                }}
                className={`${fieldBaseClasses} ${getFieldClasses(Boolean(localFilters.taxonomyKey))}`}
              >
                <option value="">Select</option>
                {taxonomies.map(t => (
                  <option key={t.key} value={t.key}>
                    {t.key}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600">Label</label>
              <div className="mt-1 relative">
                <input
                  type="text"
                  value={submittedLabelQuery}
                  onChange={e => setSubmittedLabelQuery(e.target.value)}
                  onFocus={() => {
                    if (localFilters.taxonomyKey && !isSubmittedDropdownOpen) {
                      setIsSubmittedDropdownOpen(true)
                    }
                  }}
                  onBlur={() => {
                    setTimeout(() => setIsSubmittedDropdownOpen(false), 150)
                  }}
                  placeholder={localFilters.taxonomyKey ? 'Search code or text' : 'Select taxonomy first'}
                  disabled={!localFilters.taxonomyKey}
                  className={`${fieldBaseClasses} ${getFieldClasses(Boolean(localFilters.code))}`}
                />
                {submittedLabelLoading && isSubmittedDropdownOpen && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">Loading...</span>
                )}
                {isSubmittedDropdownOpen && submittedLabelResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {submittedLabelResults.map(option => (
                      <button
                        type="button"
                        key={`submitted-${option.code}-${option.level}`}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => handleSubmittedLabelSelect(option)}
                        className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2"
                      >
                        <span className="text-sm font-semibold text-gray-800">{option.code}</span>
                        <span className="flex-1 text-sm text-gray-700 truncate">{option.label}</span>
                        <span className="text-xs text-gray-500">L{option.level}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {localFilters.code && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#D3F2EE] text-[#005c5c] text-xs font-medium px-3 py-1 border border-[#a7e4db]">
                    <span className="max-w-[220px] truncate">{selectedLabelDisplay || localFilters.code}</span>
                    <button
                      type="button"
                      onClick={clearSubmittedLabel}
                      className="text-[#005c5c]/80 hover:text-[#003f3f] transition-colors"
                      aria-label="Remove submitted label filter"
                    >
                      ×
                    </button>
                  </span>
                </div>
              )}
              <div className="mt-3">
                <label className="text-xs text-gray-600">Submitted label status</label>
                <select
                  value={
                    localFilters.hasSubmittedLabels === null ? '' : localFilters.hasSubmittedLabels ? 'true' : 'false'
                  }
                  onChange={e => {
                    const value = e.target.value
                    setLocalFilters(prev => ({
                      ...prev,
                      hasSubmittedLabels: value === '' ? null : value === 'true'
                    }))
                  }}
                  className={`${fieldBaseClasses} mt-1 ${getFieldClasses(localFilters.hasSubmittedLabels !== null)}`}
                >
                  <option value="">Any</option>
                  <option value="true">Has labels</option>
                  <option value="false">No labels</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* AI Suggestions */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">AI Suggestions</h3>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-gray-600">Taxonomy</label>
              <select
                value={localFilters.aiTaxonomyKey || ''}
                onChange={e => {
                  const value = e.target.value || null
                  setLocalFilters(prev => ({
                    ...prev,
                    aiTaxonomyKey: value,
                    aiLevel: null,
                    aiCode: null
                  }))
                  setAiLabelQuery('')
                  setAiLabelResults([])
                  setSelectedAiLabelDisplay('')
                  setIsAiDropdownOpen(false)
                }}
                className={`${fieldBaseClasses} ${getFieldClasses(Boolean(localFilters.aiTaxonomyKey))}`}
              >
                <option value="">Select</option>
                {taxonomies.map(t => (
                  <option key={`ai-${t.key}`} value={t.key}>
                    {t.key}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600">Label</label>
              <div className="mt-1 relative">
                <input
                  type="text"
                  value={aiLabelQuery}
                  onChange={e => setAiLabelQuery(e.target.value)}
                  onFocus={() => {
                    if (localFilters.aiTaxonomyKey && !isAiDropdownOpen) {
                      setIsAiDropdownOpen(true)
                    }
                  }}
                  onBlur={() => {
                    setTimeout(() => setIsAiDropdownOpen(false), 150)
                  }}
                  placeholder={localFilters.aiTaxonomyKey ? 'Search code or text' : 'Select taxonomy first'}
                  disabled={!localFilters.aiTaxonomyKey}
                  className={`${fieldBaseClasses} ${getFieldClasses(Boolean(localFilters.aiCode))}`}
                />
                {aiLabelLoading && isAiDropdownOpen && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">Loading...</span>
                )}
                {isAiDropdownOpen && aiLabelResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {aiLabelResults.map(option => (
                      <button
                        type="button"
                        key={`ai-${option.code}-${option.level}`}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => handleAiLabelSelect(option)}
                        className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2"
                      >
                        <span className="text-sm font-semibold text-gray-800">{option.code}</span>
                        <span className="flex-1 text-sm text-gray-700 truncate">{option.label}</span>
                        <span className="text-xs text-gray-500">L{option.level}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {localFilters.aiCode && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#D3F2EE] text-[#005c5c] text-xs font-medium px-3 py-1 border border-[#a7e4db]">
                    <span className="max-w-[220px] truncate">{selectedAiLabelDisplay || localFilters.aiCode}</span>
                    <button
                      type="button"
                      onClick={clearAiLabel}
                      className="text-[#005c5c]/80 hover:text-[#003f3f] transition-colors"
                      aria-label="Remove AI label filter"
                    >
                      ×
                    </button>
                  </span>
                </div>
              )}
              <div className="mt-3">
                <label className="text-xs text-gray-600">AI suggestion status</label>
                <select
                  value={localFilters.hasAISuggestions === null ? '' : localFilters.hasAISuggestions ? 'true' : 'false'}
                  onChange={e => {
                    const value = e.target.value
                    setLocalFilters(prev => ({
                      ...prev,
                      hasAISuggestions: value === '' ? null : value === 'true'
                    }))
                  }}
                  className={`${fieldBaseClasses} mt-1 ${getFieldClasses(localFilters.hasAISuggestions !== null)}`}
                >
                  <option value="">Any</option>
                  <option value="true">Has suggestion</option>
                  <option value="false">No suggestion</option>
                </select>
              </div>
              <div className="mt-3">
                <label className="text-xs text-gray-600 block mb-1">Confidence range</label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[11px] text-gray-500">Min</span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={localFilters.aiConfidenceMin ?? ''}
                      onChange={e => handleConfidenceChange('aiConfidenceMin', e.target.value)}
                      placeholder="0.70"
                      className={`${fieldBaseClasses} ${getFieldClasses(localFilters.aiConfidenceMin !== null)}`}
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-gray-500">Max</span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={localFilters.aiConfidenceMax ?? ''}
                      onChange={e => handleConfidenceChange('aiConfidenceMax', e.target.value)}
                      placeholder="0.95"
                      className={`${fieldBaseClasses} ${getFieldClasses(localFilters.aiConfidenceMax !== null)}`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-gray-200 space-y-2">
        <button
          onClick={handleApply}
          className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
        >
          Apply Filters
        </button>
        <button
          onClick={handleReset}
          className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
