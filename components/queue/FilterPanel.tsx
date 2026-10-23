'use client'
import { useId, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { UNKNOWN_NODE_CODES } from '@/lib/constants'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetch'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import {
  EMPTY_QUEUE_FILTERS,
  countActiveFilters,
  type QueueFilterValues,
  DOUBLE_FILTERS,
  DOUBLE_FILTER_LABELS
} from '@/lib/queue-url'
import Combobox, { type ComboboxOption } from '@/components/ui/Combobox'
import { badgeClass, buttonClass } from '@/components/ui/styles'
import { userDisplayName } from '@/lib/user-display'

interface FilterPanelProps {
  /** The applied filters (from the URL). The panel edits a draft until Apply. */
  filters: QueueFilterValues
  onApply: (filters: QueueFilterValues) => void
  onReset: () => void
  onClose: () => void
  taxonomies: Array<{ key: string; levelNames?: Record<string, string> | null }>
  users?: Array<{ id: string; username: string; name: string | null; email?: string }>
  showAssignedToFilter?: boolean
}

type NodeItem = { code: string; label: string; level: number }

type ImportFile = {
  id: string
  fileName: string
  sentenceCount: number
}

const UNKNOWN_OPTIONS: NodeItem[] = Object.entries(UNKNOWN_NODE_CODES).map(([level, code]) => ({
  code,
  label: 'Unknown',
  level: Number(level)
}))

const nodeOption = (node: NodeItem): ComboboxOption => ({
  // Value is the code (a string: leading zeros stay), unique per taxonomy.
  value: node.code,
  label: `${node.code} — ${node.label}`,
  hint: `L${node.level}`
})

/** Label search for one taxonomy: the server's matches plus the unknown codes. */
function useNodeOptions(taxonomyKey: string | null, query: string) {
  const { workspaceId, api } = useWorkspacePaths()
  const q = useDebouncedValue(query.trim(), 200)
  const params = q ? new URLSearchParams({ q }).toString() : ''
  const nodes = useQuery({
    queryKey: queryKeys.taxonomyNodes(workspaceId, taxonomyKey ?? '', params),
    queryFn: ({ signal }) =>
      fetchJson<{ items?: NodeItem[] }>(api(`/taxonomies/${taxonomyKey}/nodes${params ? `?${params}` : ''}`), {
        signal
      }),
    enabled: Boolean(taxonomyKey),
    placeholderData: keepPreviousData
  })
  const needle = q.toLowerCase()
  const unknown = UNKNOWN_OPTIONS.filter(
    o => !needle || o.label.toLowerCase().includes(needle) || o.code.includes(needle)
  )
  return {
    options: [...(nodes.data?.items ?? []), ...unknown].map(nodeOption),
    loading: nodes.isFetching
  }
}

const fieldBaseClasses =
  'w-full px-2 py-1 text-sm border rounded focus:outline-none focus-visible:ring-2 transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed'
const getFieldClasses = (active: boolean) =>
  active ? 'border-teal-500 bg-[#e6fbf8] focus-visible:ring-teal-500' : 'border-gray-300 focus-visible:ring-indigo-500'

const booleanValue = (value: boolean | null) => (value === null ? '' : value ? 'true' : 'false')
const parseBoolean = (value: string) => (value === '' ? null : value === 'true')

export default function FilterPanel({
  filters,
  onApply,
  onReset,
  onClose,
  taxonomies,
  users = [],
  showAssignedToFilter = false
}: FilterPanelProps) {
  const id = useId()
  const { workspaceId, api } = useWorkspacePaths()
  // The parent remounts the panel (key) when the applied filters change, so the
  // draft starts from them without syncing state in an effect.
  const [draft, setDraft] = useState<QueueFilterValues>(filters)
  const set = <K extends keyof QueueFilterValues>(key: K, value: QueueFilterValues[K]) =>
    setDraft(prev => ({ ...prev, [key]: value }))

  const imports = useQuery({
    queryKey: queryKeys.imports(workspaceId),
    queryFn: ({ signal }) => fetchJson<{ ok?: boolean; imports?: ImportFile[] }>(api('/imports'), { signal })
  })

  const [labelQuery, setLabelQuery] = useState('')
  const [aiLabelQuery, setAiLabelQuery] = useState('')
  // What to show for a chosen code once its option has scrolled out of the search results.
  const [codeLabels, setCodeLabels] = useState<Record<string, string>>({})
  const labelOptions = useNodeOptions(draft.taxonomyKey, labelQuery)
  const aiLabelOptions = useNodeOptions(draft.aiTaxonomyKey, aiLabelQuery)

  const userOptions: ComboboxOption[] = users.map(u => ({
    value: u.id,
    label: userDisplayName(u),
    hint: u.email
  }))

  const handleConfidenceChange = (field: 'aiConfidenceMin' | 'aiConfidenceMax', value: string) => {
    if (value === '') return set(field, null)
    const parsed = parseFloat(value)
    if (Number.isNaN(parsed)) return
    set(field, Math.min(Math.max(parsed, 0), 1).toString())
  }

  const setDateRange = (days: number | null) => {
    if (days === null) {
      setDraft(prev => ({ ...prev, lastEditedFrom: null, lastEditedTo: null }))
      return
    }
    const today = new Date()
    const from = new Date(today)
    from.setDate(today.getDate() - days)
    setDraft(prev => ({
      ...prev,
      lastEditedFrom: from.toISOString().slice(0, 10),
      lastEditedTo: today.toISOString().slice(0, 10)
    }))
  }

  const handleReset = () => {
    setDraft(EMPTY_QUEUE_FILTERS)
    setLabelQuery('')
    setAiLabelQuery('')
    onReset()
  }

  const activeFilterCount = countActiveFilters(filters)
  const sectionHeading = 'text-sm font-medium text-gray-700 mb-2'
  const presetButton = 'px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 transition-colors'

  return (
    <aside aria-label="Filters" className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between min-h-[76px]">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-900">Filters</h2>
          {activeFilterCount > 0 && <span className={badgeClass('solid')}>{activeFilterCount}</span>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 hover:bg-gray-200 rounded transition-colors"
          title="Hide filters"
          aria-label="Hide filters"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {/* Filter Sections */}
      <div className="flex-1 p-4 space-y-6 overflow-y-auto">
        {/* Flags & Comments */}
        <fieldset>
          <legend className={sectionHeading}>Flags & Comments</legend>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.flagged === true}
                onChange={e => set('flagged', e.target.checked ? true : null)}
                className="rounded border-gray-500 text-indigo-600 focus-visible:ring-indigo-500"
              />
              <span className="text-sm text-gray-700 flex items-center gap-1">
                <svg
                  className="w-4 h-4 text-[#F56476]"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                >
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
                checked={draft.hasComments === true}
                onChange={e => set('hasComments', e.target.checked ? true : null)}
                className="rounded border-gray-500 text-indigo-600 focus-visible:ring-indigo-500"
              />
              <span className="text-sm text-gray-700 flex items-center gap-1">
                <svg
                  className="w-4 h-4 text-[#A7ACD9]"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M3 3h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6l-3 3v-9a1 1 0 0 1 1-1z" />
                </svg>
                Has comments (including resolved)
              </span>
            </label>
          </div>
        </fieldset>

        {/* Double annotation (managers) */}
        {showAssignedToFilter && (
          <div>
            <label htmlFor={`${id}-double`} className={`block ${sectionHeading}`}>
              Double annotation
            </label>
            <select
              id={`${id}-double`}
              value={draft.double || ''}
              onChange={e => set('double', (e.target.value || null) as QueueFilterValues['double'])}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus-visible:ring-2 ${getFieldClasses(Boolean(draft.double))}`}
            >
              <option value="">All records</option>
              {DOUBLE_FILTERS.map(value => (
                <option key={value} value={value}>
                  {DOUBLE_FILTER_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Assigned To */}
        {showAssignedToFilter && (
          <Combobox
            label="Assigned to"
            labelClassName={`block ${sectionHeading}`}
            options={[{ value: 'unassigned', label: 'Unassigned' }, ...userOptions]}
            value={draft.assignedToUserId}
            onChange={value => set('assignedToUserId', value)}
            placeholder="All users"
            inputClassName={getFieldClasses(Boolean(draft.assignedToUserId))}
          />
        )}

        {/* Last Editor */}
        {users.length > 0 && (
          <Combobox
            label="Last editor"
            labelClassName={`block ${sectionHeading}`}
            options={userOptions}
            value={draft.lastEditorId}
            onChange={value => set('lastEditorId', value)}
            placeholder="All editors"
            inputClassName={getFieldClasses(Boolean(draft.lastEditorId))}
          />
        )}

        {/* Import File */}
        <div>
          <label htmlFor={`${id}-import`} className={`block ${sectionHeading}`}>
            Import file
          </label>
          <select
            id={`${id}-import`}
            value={draft.importId || ''}
            onChange={e => set('importId', e.target.value || null)}
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus-visible:ring-2 ${getFieldClasses(Boolean(draft.importId))}`}
            disabled={imports.isPending}
          >
            <option value="">All imports</option>
            {(imports.data?.imports ?? []).map(imp => (
              <option key={imp.id} value={imp.id}>
                {imp.fileName} ({imp.sentenceCount.toLocaleString()} sentences)
              </option>
            ))}
          </select>
        </div>

        {/* Date Range */}
        <fieldset>
          <legend className={sectionHeading}>Last edited</legend>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1">
              <button type="button" onClick={() => setDateRange(0)} className={presetButton}>
                Today
              </button>
              <button type="button" onClick={() => setDateRange(7)} className={presetButton}>
                Last 7d
              </button>
              <button type="button" onClick={() => setDateRange(30)} className={presetButton}>
                Last 30d
              </button>
              <button type="button" onClick={() => setDateRange(null)} className={`${presetButton} text-gray-600`}>
                Clear
              </button>
            </div>

            <div className="pt-2 border-t border-gray-200 space-y-2">
              <div>
                <label htmlFor={`${id}-from`} className="text-xs text-gray-600 block mb-1">
                  From
                </label>
                <input
                  id={`${id}-from`}
                  type="date"
                  value={draft.lastEditedFrom || ''}
                  onChange={e => set('lastEditedFrom', e.target.value || null)}
                  className={`${fieldBaseClasses} py-1.5 ${getFieldClasses(Boolean(draft.lastEditedFrom))}`}
                />
              </div>
              <div>
                <label htmlFor={`${id}-to`} className="text-xs text-gray-600 block mb-1">
                  To
                </label>
                <input
                  id={`${id}-to`}
                  type="date"
                  value={draft.lastEditedTo || ''}
                  onChange={e => set('lastEditedTo', e.target.value || null)}
                  className={`${fieldBaseClasses} py-1.5 ${getFieldClasses(Boolean(draft.lastEditedTo))}`}
                />
              </div>
            </div>
          </div>
        </fieldset>

        {/* Submitted labels */}
        <fieldset>
          <legend className={sectionHeading}>Submitted labels</legend>
          <div className="space-y-3">
            <div>
              <label htmlFor={`${id}-taxonomy`} className="text-xs text-gray-600 block mb-1">
                Taxonomy
              </label>
              <select
                id={`${id}-taxonomy`}
                value={draft.taxonomyKey || ''}
                onChange={e => {
                  setDraft(prev => ({ ...prev, taxonomyKey: e.target.value || null, level: null, code: null }))
                  setLabelQuery('')
                }}
                className={`${fieldBaseClasses} ${getFieldClasses(Boolean(draft.taxonomyKey))}`}
              >
                <option value="">Select</option>
                {taxonomies.map(t => (
                  <option key={t.key} value={t.key}>
                    {t.key}
                  </option>
                ))}
              </select>
            </div>
            <Combobox
              label="Label"
              options={labelOptions.options}
              loading={labelOptions.loading}
              onQueryChange={setLabelQuery}
              value={draft.code}
              selectedLabel={draft.code ? (codeLabels[`user:${draft.code}`] ?? draft.code) : undefined}
              onChange={(value, option) => {
                set('code', value)
                if (value && option) setCodeLabels(prev => ({ ...prev, [`user:${value}`]: option.label }))
              }}
              placeholder={draft.taxonomyKey ? 'Search code or text' : 'Select taxonomy first'}
              disabled={!draft.taxonomyKey}
              inputClassName={getFieldClasses(Boolean(draft.code))}
            />
            <div>
              <label htmlFor={`${id}-has-labels`} className="text-xs text-gray-600 block mb-1">
                Submitted label status
              </label>
              <select
                id={`${id}-has-labels`}
                value={booleanValue(draft.hasSubmittedLabels)}
                onChange={e => set('hasSubmittedLabels', parseBoolean(e.target.value))}
                className={`${fieldBaseClasses} ${getFieldClasses(draft.hasSubmittedLabels !== null)}`}
              >
                <option value="">Any</option>
                <option value="true">Has labels</option>
                <option value="false">No labels</option>
              </select>
            </div>
          </div>
        </fieldset>

        {/* AI Suggestions */}
        <fieldset>
          <legend className={sectionHeading}>AI suggestions</legend>
          <div className="space-y-3">
            <div>
              <label htmlFor={`${id}-ai-taxonomy`} className="text-xs text-gray-600 block mb-1">
                Taxonomy
              </label>
              <select
                id={`${id}-ai-taxonomy`}
                value={draft.aiTaxonomyKey || ''}
                onChange={e => {
                  setDraft(prev => ({ ...prev, aiTaxonomyKey: e.target.value || null, aiLevel: null, aiCode: null }))
                  setAiLabelQuery('')
                }}
                className={`${fieldBaseClasses} ${getFieldClasses(Boolean(draft.aiTaxonomyKey))}`}
              >
                <option value="">Select</option>
                {taxonomies.map(t => (
                  <option key={`ai-${t.key}`} value={t.key}>
                    {t.key}
                  </option>
                ))}
              </select>
            </div>
            <Combobox
              label="Suggested label"
              options={aiLabelOptions.options}
              loading={aiLabelOptions.loading}
              onQueryChange={setAiLabelQuery}
              value={draft.aiCode}
              selectedLabel={draft.aiCode ? (codeLabels[`ai:${draft.aiCode}`] ?? draft.aiCode) : undefined}
              onChange={(value, option) => {
                set('aiCode', value)
                if (value && option) setCodeLabels(prev => ({ ...prev, [`ai:${value}`]: option.label }))
              }}
              placeholder={draft.aiTaxonomyKey ? 'Search code or text' : 'Select taxonomy first'}
              disabled={!draft.aiTaxonomyKey}
              inputClassName={getFieldClasses(Boolean(draft.aiCode))}
            />
            <div>
              <label htmlFor={`${id}-has-ai`} className="text-xs text-gray-600 block mb-1">
                AI suggestion status
              </label>
              <select
                id={`${id}-has-ai`}
                value={booleanValue(draft.hasAISuggestions)}
                onChange={e => set('hasAISuggestions', parseBoolean(e.target.value))}
                className={`${fieldBaseClasses} ${getFieldClasses(draft.hasAISuggestions !== null)}`}
              >
                <option value="">Any</option>
                <option value="true">Has suggestion</option>
                <option value="false">No suggestion</option>
              </select>
            </div>
            <fieldset>
              <legend className="text-xs text-gray-600 block mb-1">Confidence range</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] text-gray-600">Min</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={draft.aiConfidenceMin ?? ''}
                    onChange={e => handleConfidenceChange('aiConfidenceMin', e.target.value)}
                    placeholder="0.70"
                    className={`${fieldBaseClasses} ${getFieldClasses(draft.aiConfidenceMin !== null)}`}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-gray-600">Max</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={draft.aiConfidenceMax ?? ''}
                    onChange={e => handleConfidenceChange('aiConfidenceMax', e.target.value)}
                    placeholder="0.95"
                    className={`${fieldBaseClasses} ${getFieldClasses(draft.aiConfidenceMax !== null)}`}
                  />
                </label>
              </div>
            </fieldset>
          </div>
        </fieldset>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-gray-200 space-y-2">
        <button type="button" onClick={() => onApply(draft)} className={buttonClass('primary', 'md', 'w-full')}>
          Apply filters
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
        >
          Reset
        </button>
      </div>
    </aside>
  )
}
