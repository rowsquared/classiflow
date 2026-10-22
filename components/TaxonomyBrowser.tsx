'use client'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { useEffect, useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { buttonClass } from '@/components/ui/styles'
import { Info } from 'lucide-react'
import Tooltip from '@/components/Tooltip'
import { isUnknownNodeCode } from '@/lib/constants'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetch'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useStoredBoolean } from '@/lib/use-local-storage'
import { aiSuggestionPath, labelsSignature, positionForLabels, sameLabelPath, type SelectedLabel } from '@/lib/labeling'

export type { SelectedLabel }

// Custom AI suggestion icon
function SolidSparkle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M11.787 6.654l-2.895-1.03-1.081-3.403A.324.324 0 007.5 2c-.143 0-.27.09-.311.221l-1.08 3.404-2.897 1.03A.313.313 0 003 6.946c0 .13.085.248.212.293l2.894 1.03 1.082 3.507A.324.324 0 007.5 12c.144 0 .271-.09.312-.224L8.893 8.27l2.895-1.029A.313.313 0 0012 6.947a.314.314 0 00-.213-.293zM4.448 1.77l-1.05-.39-.39-1.05a.444.444 0 00-.833 0l-.39 1.05-1.05.39a.445.445 0 000 .833l1.05.389.39 1.051a.445.445 0 00.833 0l.39-1.051 1.05-.389a.445.445 0 000-.834z"
        fill="currentColor"
      />
    </svg>
  )
}

export type TaxonomyNode = {
  code: string
  label: string
  level: number
  parentCode: string | null
  isLeaf: boolean
  definition?: string
  examples?: string
}

export type Taxonomy = {
  key: string
  maxDepth: number
  levelNames?: Record<string, string> | null
}

// Helper function to build tooltip content from definition and examples
function buildTooltipContent(definition?: string, examples?: string): string {
  const parts: string[] = []
  if (definition) {
    parts.push(definition)
  }
  if (examples) {
    if (parts.length > 0) {
      parts.push('\n\n**Examples:**\n' + examples)
    } else {
      parts.push('**Examples:**\n' + examples)
    }
  }
  return parts.join('')
}

interface TaxonomyBrowserProps {
  taxonomy: Taxonomy
  selectedLabels: SelectedLabel[]
  onLabelsChange: (labels: SelectedLabel[]) => void
  taxonomyIndex?: number // Index of this taxonomy (0 = first, uses primary/teal color)
  onCurrentLevelChange?: (level: number) => void // Callback to expose current level to parent
  showTabs?: boolean
  disabled?: boolean
}

type NodesResponse = { items: TaxonomyNode[]; total: number; offset: number; limit: number }

/**
 * Browse one taxonomy level by level, or search it, and choose a path of
 * labels. Mount it with a key per record and taxonomy: the level shown
 * follows the selected labels (the deepest chosen non-leaf opens its
 * children), and moving around (Up, a chip, the restore button) is kept until
 * the labels change again.
 */
export default function TaxonomyBrowser({
  taxonomy,
  selectedLabels,
  onLabelsChange,
  taxonomyIndex = 0,
  onCurrentLevelChange,
  showTabs = false,
  disabled = false
}: TaxonomyBrowserProps) {
  const { href, api, workspaceId } = useWorkspacePaths()
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [showLevelNames, setShowLevelNames] = useStoredBoolean('showLevelNames', true)

  // Where the browser is: derived from the selected labels unless the user
  // moved since they last changed (that move is remembered with the labels'
  // signature, so the next label change takes over again).
  const signature = labelsSignature(selectedLabels)
  const [moved, setMoved] = useState<{ level: number; parent: string | null; signature: string } | null>(null)
  const position = moved && moved.signature === signature ? moved : positionForLabels(selectedLabels, taxonomy.maxDepth)
  const currentLevel = position.level
  const currentParent = position.parent
  const navigate = (level: number, parent: string | null, forLabels = selectedLabels) =>
    setMoved({ level, parent, signature: labelsSignature(forLabels) })

  useEffect(() => {
    onCurrentLevelChange?.(currentLevel)
  }, [currentLevel, onCurrentLevelChange])

  // The AI suggestion as it first arrived, so it can be restored after edits.
  const [storedAISuggestions, setStoredAISuggestions] = useState(() => aiSuggestionPath(selectedLabels))
  if (storedAISuggestions === null) {
    const arrived = aiSuggestionPath(selectedLabels)
    if (arrived) setStoredAISuggestions(arrived)
  }

  // Helper to get level label
  const getLevelLabel = (level: number): string => {
    if (!showLevelNames || !taxonomy.levelNames) {
      return `Level ${level}`
    }
    return taxonomy.levelNames[level] || `Level ${level}`
  }

  // Color scheme for different taxonomies (matches queue table)
  // Index 0 uses primary/teal color, others use different colors
  const getTaxonomyColors = (index: number) => {
    const colors = [
      // Index 0: Primary/Teal (#008080 family)
      {
        chip: 'bg-[#D3F2EE] text-[#005c5c] border-[#a7e4db] hover:bg-[#bee8e1]',
        chipLevel: 'bg-[#a7e4db] text-[#005c5c]',
        chipDelete: 'text-[#008080] hover:text-[#005050] hover:bg-[#c9efea]',
        selectedBg: 'bg-[#e6fbf8]',
        code: 'text-[#008080]',
        codeSelected: 'text-[#008080]',
        hoverBg: 'hover:bg-[#edfdfa]',
        indicator: 'text-[#008080]',
        indicatorSelected: 'text-[#008080]'
      },
      // Index 1: Blue (#3A67BB)
      {
        chip: 'bg-[#E3EBFB] text-[#28498c] border-[#c4d4f6] hover:bg-[#d4def8]',
        chipLevel: 'bg-[#c4d4f6] text-[#28498c]',
        chipDelete: 'text-[#3A67BB] hover:text-[#243f74] hover:bg-[#dbe4fb]',
        selectedBg: 'bg-[#eff3fd]',
        code: 'text-[#3A67BB]',
        codeSelected: 'text-[#3A67BB]',
        hoverBg: 'hover:bg-[#eff3fd]',
        indicator: 'text-[#3A67BB]',
        indicatorSelected: 'text-[#3A67BB]'
      },
      // Index 2: Plum (#A14A76)
      {
        chip: 'bg-[#F6E4EC] text-[#6d2c4a] border-[#e7bfd1] hover:bg-[#f0d4df]',
        chipLevel: 'bg-[#e7bfd1] text-[#6d2c4a]',
        chipDelete: 'text-[#A14A76] hover:text-[#6b2747] hover:bg-[#f1d4e2]',
        selectedBg: 'bg-[#fbf0f5]',
        code: 'text-[#A14A76]',
        codeSelected: 'text-[#A14A76]',
        hoverBg: 'hover:bg-[#fbf0f5]',
        indicator: 'text-[#A14A76]',
        indicatorSelected: 'text-[#A14A76]'
      },
      // Index 3: Rose
      {
        chip: 'bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-200',
        chipLevel: 'bg-rose-200 text-rose-700',
        chipDelete: 'text-rose-600 hover:text-rose-900 hover:bg-rose-200',
        selectedBg: 'bg-rose-50',
        code: 'text-rose-600',
        codeSelected: 'text-rose-600',
        hoverBg: 'hover:bg-rose-50',
        indicator: 'text-rose-600',
        indicatorSelected: 'text-rose-600'
      },
      // Index 4: Orange
      {
        chip: 'bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200',
        chipLevel: 'bg-orange-200 text-orange-700',
        chipDelete: 'text-orange-600 hover:text-orange-900 hover:bg-orange-200',
        selectedBg: 'bg-orange-50',
        code: 'text-orange-600',
        codeSelected: 'text-orange-600',
        hoverBg: 'hover:bg-orange-50',
        indicator: 'text-orange-600',
        indicatorSelected: 'text-orange-600'
      }
    ]
    return colors[index % colors.length] ?? colors[0]!
  }

  const colors = getTaxonomyColors(taxonomyIndex)

  // Toggle level names
  const toggleLevelNames = () => setShowLevelNames(!showLevelNames)

  // Nodes of the current level (browsing) or matches across all levels (searching).
  const debouncedSearch = useDebouncedValue(searchQuery, 300)
  const browseParams = new URLSearchParams({ level: String(currentLevel) })
  if (currentParent !== null) browseParams.set('parentCode', currentParent)
  const nodesParams = searchQuery ? new URLSearchParams({ q: debouncedSearch }).toString() : browseParams.toString()
  const nodesQuery = useInfiniteQuery({
    queryKey: [...queryKeys.taxonomyNodes(workspaceId, taxonomy.key, nodesParams), 'pages'],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      fetchJson<NodesResponse>(api(`/taxonomies/${taxonomy.key}/nodes?${nodesParams}&offset=${pageParam}`), { signal }),
    getNextPageParam: page =>
      page.offset + page.items.length < page.total ? page.offset + page.items.length : undefined,
    enabled: !searchQuery || debouncedSearch === searchQuery,
    retry: false
  })
  const taxonomyNodes = nodesQuery.data?.pages.flatMap(page => page.items) ?? []
  const isLoadingNodes = nodesQuery.isPending || (Boolean(searchQuery) && debouncedSearch !== searchQuery)

  // Fetch each ancestor by its exact code. Searching through capped pages could
  // silently construct an incomplete path in a large taxonomy.
  const pathMutation = useMutation({
    mutationFn: async (node: TaxonomyNode) => {
      const path = [node]
      let current = node
      while (current.parentCode !== null) {
        const params = new URLSearchParams({ code: current.parentCode })
        const data = await queryClient.fetchQuery({
          queryKey: queryKeys.taxonomyNodes(workspaceId, taxonomy.key, params.toString()),
          queryFn: ({ signal }) =>
            fetchJson<NodesResponse>(api(`/taxonomies/${taxonomy.key}/nodes?${params}`), { signal })
        })
        const parent = data.items[0]
        if (!parent || parent.level !== current.level - 1)
          throw new Error('The label path could not be loaded. Please try again.')
        path.unshift(parent)
        current = parent
      }
      if (path[0]?.level !== 1) throw new Error('The label path could not be loaded. Please try again.')
      return path
    },
    onSuccess: path => {
      onLabelsChange(
        path.map(node => ({
          level: node.level,
          nodeCode: node.code,
          taxonomyKey: taxonomy.key,
          label: node.label,
          definition: node.definition,
          examples: node.examples,
          isLeaf: node.isLeaf || node.level >= taxonomy.maxDepth
        }))
      )
      setSearchQuery('')
    }
  })
  const busy = disabled || pathMutation.isPending
  const hasAISuggestions = Boolean(storedAISuggestions && storedAISuggestions.length > 0)

  // Check if we've diverged from AI suggestions:
  // 1. User selected different labels (paths don't match)
  // 2. User deleted some AI suggestions (current labels are subset or different)
  const hasDivergedFromAISuggestions =
    hasAISuggestions &&
    (!sameLabelPath(selectedLabels, storedAISuggestions) ||
      // Also show if user deleted AI suggestions (current labels don't include all cached AI labels)
      selectedLabels.filter(l => l.source === 'ai').length < (storedAISuggestions?.length ?? 0))

  const handleRestoreAISuggestions = () => {
    if (!storedAISuggestions) return
    const restored = storedAISuggestions.map(label => ({ ...label }))
    onLabelsChange(restored)
    setSearchQuery('')
  }

  // Handle node click
  const handleNodeClick = (node: TaxonomyNode) => {
    if (busy) return
    const isLeaf = node.isLeaf || node.level >= taxonomy.maxDepth
    if (searchQuery) {
      pathMutation.mutate(node)
    } else {
      // Normal navigation mode
      const newLabel: SelectedLabel = {
        level: node.level,
        nodeCode: node.code,
        taxonomyKey: taxonomy.key,
        label: node.label,
        definition: node.definition,
        examples: node.examples,
        isLeaf
      }

      // Remove any selections at this level or higher, then add this one
      const newLabels = selectedLabels.filter(l => l.level < node.level)
      newLabels.push(newLabel)
      onLabelsChange(newLabels)
    }
  }

  // One level up: the parent level, showing the siblings of the label chosen there.
  const handleUp = () => {
    const level = currentLevel - 1
    if (level < 1) return
    navigate(level, level === 1 ? null : (selectedLabels.find(l => l.level === level - 1)?.nodeCode ?? null))
  }

  // Handle chip click (navigate to that level)
  const handleChipClick = (label: SelectedLabel) => {
    if (label.level === -1) return // Don't navigate for Unknown
    navigate(
      label.level,
      label.level === 1 ? null : selectedLabels.find(l => l.level === label.level - 1)?.nodeCode || null
    )
    setSearchQuery('')
  }

  // Handle chip delete
  const handleChipDelete = (label: SelectedLabel) => {
    // Remove this label and any labels at higher levels
    const remainingLabels = selectedLabels.filter(l => l.level < label.level).sort((a, b) => a.level - b.level)
    onLabelsChange(remainingLabels)

    // Show the children of the deepest remaining label to choose a different path
    const lastRemainingLabel = remainingLabels.at(-1)
    if (lastRemainingLabel) {
      navigate(lastRemainingLabel.level + 1, lastRemainingLabel.nodeCode, remainingLabels)
    } else {
      navigate(1, null, remainingLabels)
    }

    setSearchQuery('')
  }

  return (
    <fieldset disabled={busy} className="min-w-0 flex-1 overflow-y-auto p-6 flex flex-col">
      <div className="space-y-4 flex-shrink-0">
        {/* Selected Labels as Chips */}
        <div>
          {!showTabs && <h3 className="text-sm font-medium text-gray-700 mb-2">{taxonomy.key}</h3>}
          <div className="flex flex-wrap gap-2">
            {selectedLabels.length === 0 ? (
              <span className="text-gray-500 text-sm">No labels selected</span>
            ) : (
              [...selectedLabels]
                .sort((a, b) => a.level - b.level)
                .map((label, i) => {
                  const chipContent = (
                    <div
                      key={i}
                      className={`inline-flex items-center px-2 py-1 rounded text-sm border cursor-pointer transition-colors ${colors.chip}`}
                      role="group"
                      aria-label={`Selected label ${label.nodeCode}`}
                    >
                      <button
                        type="button"
                        onClick={() => handleChipClick(label)}
                        className={`text-xs px-2 py-0.5 rounded ${colors.chipLevel}`}
                        aria-label={`Browse level ${label.level} for ${label.nodeCode}`}
                      >
                        L{label.level}
                      </button>
                      <span className="ml-2 font-medium">
                        {isUnknownNodeCode(label.nodeCode)
                          ? 'Unknown'
                          : `${label.nodeCode} - ${label.label || 'Loading...'}`}
                      </span>
                      {(label.definition || label.examples) && (
                        <Info className="ml-1 w-3.5 h-3.5 text-gray-500 flex-shrink-0" strokeWidth={2.5} />
                      )}
                      {label.source === 'ai' && (
                        <>
                          <SolidSparkle className="ml-2 w-3 h-3 flex-shrink-0" />
                          {label.confidenceScore !== undefined && (
                            <span className="ml-1 text-xs font-medium">{label.confidenceScore.toFixed(2)}</span>
                          )}
                        </>
                      )}
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          handleChipDelete(label)
                        }}
                        className={`ml-2 w-4 h-4 flex items-center justify-center ${colors.chipDelete}`}
                        aria-label={`Remove label ${label.nodeCode}`}
                      >
                        ×
                      </button>
                    </div>
                  )

                  if (label.definition || label.examples) {
                    const tooltipContent = buildTooltipContent(label.definition, label.examples)
                    return (
                      <Tooltip key={i} content={tooltipContent} side="top">
                        {chipContent}
                      </Tooltip>
                    )
                  }

                  return chipContent
                })
            )}
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${taxonomy?.key || 'taxonomy'}`}
            aria-label={`Search ${taxonomy?.key || 'taxonomy'}`}
            className="w-full px-4 py-2 pr-10 border border-gray-500 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-gray-900"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-900 w-5 h-5 flex items-center justify-center"
              title="Clear search"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {/* Level Indicator & Navigation */}
        {!searchQuery && (
          <div className="flex items-center justify-between min-h-[32px]">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-gray-700">{getLevelLabel(currentLevel)}</h4>
              {taxonomy.levelNames && Object.keys(taxonomy.levelNames).length > 0 && (
                <button
                  onClick={toggleLevelNames}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                  title={showLevelNames ? 'Show as Level 1, Level 2, ...' : 'Show custom level names'}
                >
                  {showLevelNames ? '123' : 'ABC'}
                </button>
              )}
            </div>
            {/* Always reserve space for Up button to prevent layout shift */}
            <div className="min-w-[120px] flex justify-end gap-2">
              {hasDivergedFromAISuggestions && (
                <button
                  onClick={handleRestoreAISuggestions}
                  className="text-gray-600 hover:text-gray-800 text-xs px-2 py-1 border rounded"
                  title="Restore AI suggested labels"
                >
                  AI suggestion
                </button>
              )}
              {currentLevel > 1 && (
                <button
                  onClick={handleUp}
                  className="text-gray-600 hover:text-gray-800 text-xs px-2 py-1 border rounded"
                >
                  ↑ Up
                </button>
              )}
            </div>
          </div>
        )}

        {/* Taxonomy Nodes */}
        <div className="space-y-0 flex-1 overflow-y-auto border-t border-gray-200">
          {pathMutation.isError && (
            <div role="alert" className="py-3 text-sm text-red-700">
              {pathMutation.error.message}
            </div>
          )}
          {nodesQuery.isError && (
            <div role="alert" className="py-3 text-sm text-red-700">
              Could not load labels.{' '}
              <button type="button" onClick={() => nodesQuery.refetch()} className={buttonClass('secondary', 'sm')}>
                Retry
              </button>
            </div>
          )}
          {isLoadingNodes ? (
            <div className="text-center py-8 text-gray-500">
              <div className="text-sm">Loading...</div>
            </div>
          ) : taxonomyNodes.length === 0 && !nodesQuery.isError ? (
            <div className="text-center py-8 text-gray-500">
              {searchQuery ? (
                <div>
                  <div className="text-lg mb-2">No results found</div>
                  <div className="text-sm">Try a different search term</div>
                </div>
              ) : (
                <div className="text-gray-500">
                  No labels available.{' '}
                  <a href={href('/admin/taxonomy')} className="text-indigo-600 hover:text-indigo-700 underline">
                    Import taxonomy
                  </a>
                </div>
              )}
            </div>
          ) : (
            taxonomyNodes.map(node => {
              const isSelected = selectedLabels.some(l => l.level === node.level && l.nodeCode === node.code)
              const nodeContent = (
                <div
                  key={node.code}
                  role="button"
                  tabIndex={busy ? -1 : 0}
                  aria-disabled={busy}
                  aria-pressed={isSelected}
                  onClick={() => handleNodeClick(node)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      handleNodeClick(node)
                    }
                  }}
                  className={`px-4 py-3 cursor-pointer transition-colors border-b border-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                    isSelected ? colors.selectedBg : colors.hoverBg
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      {/* Code - fixed width for alignment */}
                      <div
                        className={`text-[15px] font-semibold flex-shrink-0 w-12 ${
                          isSelected ? colors.codeSelected : colors.code
                        }`}
                      >
                        {node.code}
                      </div>

                      {/* Label and definition */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap text-gray-900">
                          <div className="text-[15px] leading-snug">{node.label}</div>
                          {searchQuery && (
                            <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded bg-gray-200 text-gray-700">
                              L{node.level}
                            </span>
                          )}
                          {(node.definition || node.examples) && (
                            <Info className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" strokeWidth={2.5} />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Arrow/Indicator */}
                    <div className={`flex-shrink-0 text-sm ${isSelected ? colors.indicatorSelected : 'text-gray-500'}`}>
                      {isSelected ? '✓' : node.isLeaf ? '•' : '→'}
                    </div>
                  </div>
                </div>
              )

              // Wrap with tooltip if definition or examples exist
              if (node.definition || node.examples) {
                const tooltipContent = buildTooltipContent(node.definition, node.examples)
                return (
                  <Tooltip key={node.code} content={tooltipContent} side="right">
                    {nodeContent}
                  </Tooltip>
                )
              }

              return nodeContent
            })
          )}
        </div>
        {nodesQuery.hasNextPage && (
          <button
            type="button"
            disabled={nodesQuery.isFetchingNextPage || busy}
            onClick={() => nodesQuery.fetchNextPage()}
            className={buttonClass('secondary')}
          >
            {nodesQuery.isFetchingNextPage ? 'Loading…' : 'Load more labels'}
          </button>
        )}
      </div>
    </fieldset>
  )
}
