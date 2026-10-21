"use client"
import { useWorkspacePaths, workspaceApi } from '@/lib/workspace/urls'
import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { Info } from 'lucide-react'
import Tooltip from '@/components/Tooltip'
import { isUnknownNodeCode } from '@/lib/constants'

// Custom AI suggestion icon
function SolidSparkle({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
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

export type SelectedLabel = {
  level: number
  nodeCode: string
  taxonomyKey: string
  label?: string
  definition?: string
  examples?: string
  isLeaf?: boolean
  source?: 'user' | 'ai'
  confidenceScore?: number
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
  onNavigate?: (level: number, parent: string | null) => void
  taxonomyIndex?: number // Index of this taxonomy (0 = first, uses primary/teal color)
  onCurrentLevelChange?: (level: number) => void // Callback to expose current level to parent
  showTabs?: boolean
}

export default function TaxonomyBrowser({
  taxonomy,
  selectedLabels,
  onLabelsChange,
  onNavigate,
  taxonomyIndex = 0,
  onCurrentLevelChange,
  showTabs = false
}: TaxonomyBrowserProps) {
  const { href } = useWorkspacePaths()
  const [currentLevel, setCurrentLevel] = useState(1)
  const [currentParent, setCurrentParent] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [taxonomyNodes, setTaxonomyNodes] = useState<TaxonomyNode[]>([])
  const [breadcrumb, setBreadcrumb] = useState<TaxonomyNode[]>([])
  const [isLoadingNodes, setIsLoadingNodes] = useState(true)
  const hasInitializedRef = useRef(false)
  const lastSelectedLabelsRef = useRef<string>('')
  const initialAISuggestionRef = useRef<SelectedLabel[] | null>(null)
  const initialAISuggestionSignatureRef = useRef<string | null>(null)
  const normalizeLabels = (labels: SelectedLabel[]) =>
    [...labels]
      .filter(l => l.level > 0)
      .sort((a, b) => a.level - b.level)
      .map(l => ({ level: l.level, code: l.nodeCode }))

  const arePathsEqual = (a: SelectedLabel[] | null, b: SelectedLabel[] | null) => {
    if (!a || !b) return false
    const normA = normalizeLabels(a)
    const normB = normalizeLabels(b)
    if (normA.length !== normB.length) return false
    return normA.every((entry, idx) => entry.level === normB[idx].level && entry.code === normB[idx].code)
  }

  const [showLevelNames, setShowLevelNames] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('showLevelNames')
      return saved !== null ? JSON.parse(saved) : true
    }
    return true
  })

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
    return colors[index % colors.length] || colors[0]
  }

  const colors = getTaxonomyColors(taxonomyIndex)

  // Reset flags when taxonomy changes
  useEffect(() => {
    hasInitializedRef.current = false
    lastSelectedLabelsRef.current = ''
    setIsLoadingNodes(true)
    setTaxonomyNodes([])
    setCurrentLevel(1)
    setCurrentParent(null)
    initialAISuggestionRef.current = null
    initialAISuggestionSignatureRef.current = null
  }, [taxonomy.key])

  // Cache initial AI suggestions when they first appear
  useEffect(() => {
    // Only cache if we don't already have cached AI suggestions (preserve original even after deletion)
    if (initialAISuggestionRef.current !== null) {
      return
    }

    // Find AI suggestions in the current selectedLabels
    const aiLabels = selectedLabels.filter(label => label.source === 'ai')
    
    if (aiLabels.length > 0) {
      const sortedAIPath = [...aiLabels].sort((a, b) => a.level - b.level)
      const signature = JSON.stringify(normalizeLabels(sortedAIPath))
      initialAISuggestionRef.current = sortedAIPath.map(label => ({ ...label }))
      initialAISuggestionSignatureRef.current = signature
    }
  }, [selectedLabels])

  useLayoutEffect(() => {
    if (!taxonomy) return

    const labelsSignature = JSON.stringify(
      selectedLabels
        .map(l => ({ level: l.level, code: l.nodeCode, taxonomy: l.taxonomyKey, isLeaf: l.isLeaf }))
        .sort((a, b) => a.level - b.level || a.code.localeCompare(b.code))
    )

    if (hasInitializedRef.current && lastSelectedLabelsRef.current === labelsSignature) {
      return
    }

    if (selectedLabels.length === 0) {
      hasInitializedRef.current = true
      lastSelectedLabelsRef.current = labelsSignature
      if (currentLevel !== 1) {
        setCurrentLevel(1)
        onCurrentLevelChange?.(1)
      }
      if (currentParent !== null) {
        setCurrentParent(null)
      }
      setBreadcrumb([])
      onNavigate?.(1, null)
      return
    }

    let nextLevel = 1
    let nextParent: string | null = null

    if (selectedLabels.length > 0) {
      const sorted = [...selectedLabels].sort((a, b) => a.level - b.level)
      const last = sorted[sorted.length - 1]
      const prev = sorted.length > 1 ? sorted[sorted.length - 2] : undefined

      if (last) {
        const isLeaf = Boolean(last.isLeaf) || last.level >= (taxonomy.maxDepth || Number.MAX_SAFE_INTEGER)
        if (isLeaf) {
          nextLevel = last.level
          nextParent = prev ? prev.nodeCode : null
        } else {
          nextLevel = Math.min(last.level + 1, taxonomy.maxDepth || last.level + 1)
          nextParent = last.nodeCode
        }
      }
    }

    hasInitializedRef.current = true
    lastSelectedLabelsRef.current = labelsSignature

    const normalizedParent = nextParent ?? null
    const levelChanged = currentLevel !== nextLevel
    const parentChanged = (currentParent ?? null) !== normalizedParent

    if (levelChanged) {
      setCurrentLevel(nextLevel)
      onCurrentLevelChange?.(nextLevel)
    }
    if (parentChanged) {
      setCurrentParent(normalizedParent)
    }

    if (onNavigate && (levelChanged || parentChanged)) {
      onNavigate(nextLevel, normalizedParent)
    }
  }, [selectedLabels, taxonomy, currentLevel, currentParent, onCurrentLevelChange, onNavigate])

  // Build breadcrumb asynchronously after level is set
  useEffect(() => {
    if (selectedLabels.length === 0 || !hasInitializedRef.current) return
    
    const sortedLabels = [...selectedLabels]
      .filter(l => l.level > 0)
      .sort((a, b) => a.level - b.level)
    
    const buildBreadcrumb = async () => {
      try {
        const breadcrumbNodes: TaxonomyNode[] = []
        const targetLevel = Math.max(...selectedLabels.map(l => l.level))
        const labelsToShow = sortedLabels.filter(l => l.level < targetLevel)
        
        for (const label of labelsToShow) {
          try {
            const res = await fetch(workspaceApi(`/taxonomies/${taxonomy.key}/nodes?level=${label.level}`))
            if (res.ok) {
              const data = await res.json()
              const node = data.items?.find((n: TaxonomyNode) => n.code === label.nodeCode)
              if (node) {
                breadcrumbNodes.push(node)
              }
            }
          } catch (error) {
            console.error('Failed to fetch node for breadcrumb:', error)
          }
        }
        setBreadcrumb(breadcrumbNodes)
      } catch (error) {
        console.error('Failed to build breadcrumb:', error)
      }
    }
    
    buildBreadcrumb()
  }, [selectedLabels, taxonomy.key])

  // Toggle level names
  const toggleLevelNames = () => {
    const newValue = !showLevelNames
    setShowLevelNames(newValue)
    if (typeof window !== 'undefined') {
      localStorage.setItem('showLevelNames', JSON.stringify(newValue))
    }
  }

  // Load taxonomy nodes for the current level (when not searching)
  useEffect(() => {
    if (!taxonomy || searchQuery) return
    const waitingForInitialization = selectedLabels.length > 0 && !hasInitializedRef.current
    if (waitingForInitialization) return

    let cancelled = false
    setIsLoadingNodes(true)

    const params = new URLSearchParams({
      level: String(currentLevel)
    })
    if (currentParent !== null) {
      params.set('parentCode', currentParent)
    }

    const loadNodes = async () => {
      try {
        const res = await fetch(workspaceApi(`/taxonomies/${taxonomy.key}/nodes?${params}`))
        if (!res.ok) throw new Error('Failed to fetch nodes')
        const data = await res.json()
        if (!cancelled) {
          setTaxonomyNodes(data.items || [])
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load nodes:', error)
          setTaxonomyNodes([])
        }
      } finally {
        if (!cancelled) {
          setIsLoadingNodes(false)
        }
      }
    }

    loadNodes()
    return () => {
      cancelled = true
    }
  }, [taxonomy, currentLevel, currentParent, searchQuery, selectedLabels.length])

  // Search across all levels
  useEffect(() => {
    if (!taxonomy || !searchQuery) return

    let cancelled = false
    setIsLoadingNodes(true)

    const searchNodes = async () => {
      try {
        const params = new URLSearchParams({
          q: searchQuery
        })

        const res = await fetch(workspaceApi(`/taxonomies/${taxonomy.key}/nodes?${params}`))
        if (!res.ok) throw new Error('Failed to search')
        const data = await res.json()
        if (!cancelled) {
          setTaxonomyNodes(data.items || [])
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to search:', error)
          setTaxonomyNodes([])
        }
      } finally {
        if (!cancelled) {
          setIsLoadingNodes(false)
        }
      }
    }

    const timer = setTimeout(searchNodes, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [taxonomy, searchQuery])

  // Build full path by recursively fetching parents
  const buildFullPath = async (node: TaxonomyNode): Promise<TaxonomyNode[]> => {
    const path: TaxonomyNode[] = [node]
    
    let currentNode = node
    while (currentNode.parentCode !== null && currentNode.parentCode !== undefined) {
      try {
        // Fetch all nodes at the parent's level with a higher limit to ensure we get the parent
        // The default limit is 100, but some taxonomies might have more nodes at a level
        const res = await fetch(workspaceApi(`/taxonomies/${taxonomy.key}/nodes?level=${currentNode.level - 1}&limit=500`))
        if (!res.ok) {
          console.warn(`Failed to fetch nodes at level ${currentNode.level - 1}`)
          break
        }
        
        const data = await res.json()
        // Find the specific parent by code - ensure string comparison to handle leading zeros
        const parent = data.items?.find((n: TaxonomyNode) => String(n.code) === String(currentNode.parentCode))
        
        if (!parent) {
          // If parent not found in first page, check if there are more results
          if (data.total > data.items.length) {
            console.warn(`Parent node with code ${currentNode.parentCode} not found in first ${data.items.length} nodes at level ${currentNode.level - 1} (total: ${data.total})`)
            // Try fetching with offset to get more results
            let found = false
            for (let offset = data.items.length; offset < data.total && offset < 2000; offset += 500) {
              const moreRes = await fetch(workspaceApi(`/taxonomies/${taxonomy.key}/nodes?level=${currentNode.level - 1}&limit=500&offset=${offset}`))
              if (!moreRes.ok) break
              const moreData = await moreRes.json()
              const foundParent = moreData.items?.find((n: TaxonomyNode) => String(n.code) === String(currentNode.parentCode))
              if (foundParent) {
                path.unshift(foundParent)
                currentNode = foundParent
                found = true
                break
              }
            }
            if (!found) break
          } else {
            console.warn(`Parent node with code ${currentNode.parentCode} not found at level ${currentNode.level - 1}`)
            break
          }
        } else {
          path.unshift(parent) // Add to beginning of array
          currentNode = parent
        }
      } catch (error) {
        console.error('Failed to fetch parent node:', error)
        break
      }
    }
    
    return path
  }
  const storedAISuggestions = initialAISuggestionRef.current
  const hasAISuggestions = Boolean(storedAISuggestions && storedAISuggestions.length > 0)
  
  // Check if we've diverged from AI suggestions:
  // 1. User selected different labels (paths don't match)
  // 2. User deleted some AI suggestions (current labels are subset or different)
  const hasDivergedFromAISuggestions = hasAISuggestions && (
    !arePathsEqual(selectedLabels, storedAISuggestions) ||
    // Also show if user deleted AI suggestions (current labels don't include all cached AI labels)
    selectedLabels.filter(l => l.source === 'ai').length < (storedAISuggestions?.length ?? 0)
  )

  const handleRestoreAISuggestions = () => {
    if (!storedAISuggestions) return
    const restored = storedAISuggestions.map(label => ({ ...label }))
    onLabelsChange(restored)
    setSearchQuery('')
  }

  // Handle node click
  const handleNodeClick = async (node: TaxonomyNode) => {
    // Determine if this node is a leaf
    const isLeaf = node.isLeaf || node.level >= taxonomy.maxDepth

    // If in search mode, first we need to reconstruct the breadcrumb to this node
    // and set the selected labels accordingly
    if (searchQuery) {
      // Build the full path from root to this node
      const fullPath = await buildFullPath(node)
      
      // Convert path to selected labels
      const newLabels: SelectedLabel[] = fullPath.map(pathNode => ({
        level: pathNode.level,
        nodeCode: pathNode.code,
        taxonomyKey: taxonomy.key,
        label: pathNode.label,
        definition: pathNode.definition,
        examples: pathNode.examples,
        isLeaf: pathNode.isLeaf || pathNode.level >= taxonomy.maxDepth
      }))
      
      onLabelsChange(newLabels)
      
      // Clear search (navigation will be handled by effect)
      setSearchQuery('')
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
      
      // Update breadcrumb
      const newBreadcrumb = [...breadcrumb]
      if (node.level > currentLevel) {
        // Shouldn't happen but handle it
        newBreadcrumb.push(node)
      } else if (node.level === currentLevel) {
        newBreadcrumb.push(node)
      }
      setBreadcrumb(newBreadcrumb)
      
    }
  }

  // Handle breadcrumb click
  const handleBreadcrumbClick = (index: number) => {
    if (index < 0) {
      // Go to root
      setCurrentLevel(1)
      setCurrentParent(null)
      setBreadcrumb([])
      onNavigate?.(1, null)
    } else {
      const targetNode = breadcrumb[index]
      setCurrentLevel(targetNode.level + 1)
      setCurrentParent(targetNode.code)
      setBreadcrumb(breadcrumb.slice(0, index + 1))
      onNavigate?.(targetNode.level + 1, targetNode.code)
    }
  }

  // Handle chip click (navigate to that level)
  const handleChipClick = (label: SelectedLabel) => {
    if (label.level === -1) return // Don't navigate for Unknown
    
    // Rebuild breadcrumb up to this level
    const newBreadcrumb = selectedLabels
      .filter(l => l.level < label.level && l.level > 0)
      .sort((a, b) => a.level - b.level)
      .map(l => ({
        code: l.nodeCode,
        label: l.label || '',
        level: l.level,
        parentCode: null,
        isLeaf: false
      }))
    
    setBreadcrumb(newBreadcrumb)
    setCurrentLevel(label.level)
    setCurrentParent(label.level === 1 ? null : selectedLabels.find(l => l.level === label.level - 1)?.nodeCode || null)
    setSearchQuery('')
  }

  // Handle chip delete
  const handleChipDelete = (label: SelectedLabel) => {
    // Remove this label and any labels at higher levels
    const remainingLabels = selectedLabels.filter(l => l.level < label.level)
    onLabelsChange(remainingLabels)
    
    // Navigate back to this level to select a different path
    const newBreadcrumb = remainingLabels
      .sort((a, b) => a.level - b.level)
      .map(l => ({
        code: l.nodeCode,
        label: l.label || '',
        level: l.level,
        parentCode: null,
        isLeaf: false
      }))
    
    setBreadcrumb(newBreadcrumb)
    
    // Navigate to show children at the level we just deleted
    const lastRemainingLabel = remainingLabels.length > 0 
      ? remainingLabels[remainingLabels.length - 1] 
      : null
    
    if (lastRemainingLabel) {
      setCurrentLevel(lastRemainingLabel.level + 1)
      setCurrentParent(lastRemainingLabel.nodeCode)
      onNavigate?.(lastRemainingLabel.level + 1, lastRemainingLabel.nodeCode)
    } else {
      setCurrentLevel(1)
      setCurrentParent(null)
      onNavigate?.(1, null)
    }
    
    setSearchQuery('')
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col">
      <div className="space-y-4 flex-shrink-0">
        {/* Selected Labels as Chips */}
        <div>
          {!showTabs && (
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              {taxonomy.key}
            </h3>
          )}
          <div className="flex flex-wrap gap-2">
            {selectedLabels.length === 0 ? (
              <span className="text-gray-500 text-sm">No labels selected</span>
            ) : (
              selectedLabels
                .sort((a, b) => a.level - b.level)
                .map((label, i) => {
                  const chipContent = (
                    <div
                      key={i}
                      className={`inline-flex items-center px-2 py-1 rounded text-sm border cursor-pointer transition-colors ${colors.chip}`}
                      onClick={() => handleChipClick(label)}
                    >
                      <span className={`text-xs px-2 py-0.5 rounded ${colors.chipLevel}`}>
                        L{label.level}
                      </span>
                      <span className="ml-2 font-medium">
                        {isUnknownNodeCode(label.nodeCode) ? 'Unknown' : `${label.nodeCode} - ${label.label || 'Loading...'}`}
                      </span>
                      {(label.definition || label.examples) && (
                        <Info className="ml-1 w-3.5 h-3.5 text-gray-400 flex-shrink-0" strokeWidth={2.5} />
                      )}
                      {label.source === 'ai' && (
                        <>
                          <SolidSparkle className="ml-2 w-3 h-3 flex-shrink-0" />
                          {label.confidenceScore !== undefined && (
                            <span className="ml-1 text-xs font-medium">
                              {label.confidenceScore.toFixed(2)}
                            </span>
                          )}
                        </>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleChipDelete(label)
                        }}
                        className={`ml-2 rounded-full w-4 h-4 flex items-center justify-center ${colors.chipDelete}`}
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
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${taxonomy?.key || 'taxonomy'}`}
            aria-label={`Search ${taxonomy?.key || 'taxonomy'}`}
            className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 w-5 h-5 flex items-center justify-center"
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
              <h4 className="text-sm font-medium text-gray-700">
                {getLevelLabel(currentLevel)}
              </h4>
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
                  onClick={() => {
                    if (breadcrumb.length > 0) {
                      handleBreadcrumbClick(breadcrumb.length - 2)
                    } else {
                      // Fallback: go up one level
                      const parentLabel = selectedLabels.find(l => l.level === currentLevel - 1)
                      if (parentLabel) {
                        handleChipClick(parentLabel)
                      } else {
                        setCurrentLevel(currentLevel - 1)
                        setCurrentParent(currentLevel > 2 ? selectedLabels.find(l => l.level === currentLevel - 2)?.nodeCode || null : null)
                      }
                    }
                  }}
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
          {isLoadingNodes ? (
            <div className="text-center py-8 text-gray-400">
              <div className="text-sm">Loading...</div>
            </div>
          ) : taxonomyNodes.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchQuery ? (
                <div>
                  <div className="text-lg mb-2">No results found</div>
                  <div className="text-sm">Try a different search term</div>
                </div>
              ) : (
                <div className="text-gray-500">
                  No labels available. <a href={href('/admin/taxonomy')} className="text-indigo-600 hover:text-indigo-700 underline">Import taxonomy</a>
                </div>
              )}
            </div>
          ) : (
            taxonomyNodes.map((node) => {
              const isSelected = selectedLabels.some(l => l.level === node.level && l.nodeCode === node.code)
              const nodeContent = (
                <div
                  key={node.code}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onClick={() => handleNodeClick(node)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      handleNodeClick(node)
                    }
                  }}
                  className={`px-4 py-3 cursor-pointer transition-colors border-b border-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                    isSelected 
                      ? colors.selectedBg
                      : colors.hoverBg
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      {/* Code - fixed width for alignment */}
                      <div className={`text-[15px] font-semibold flex-shrink-0 w-12 ${
                        isSelected ? colors.codeSelected : colors.code
                      }`}>
                        {node.code}
                      </div>
                      
                      {/* Label and definition */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap text-gray-900">
                          <div className="text-[15px] leading-snug">
                            {node.label}
                          </div>
                          {searchQuery && (
                            <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded bg-gray-200 text-gray-700">
                              L{node.level}
                            </span>
                          )}
                          {(node.definition || node.examples) && (
                            <Info className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" strokeWidth={2.5} />
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Arrow/Indicator */}
                    <div className={`flex-shrink-0 text-sm ${
                      isSelected ? colors.indicatorSelected : 'text-gray-400'
                    }`}>
                      {isSelected ? '✓' : (node.isLeaf ? '•' : '→')}
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
      </div>
    </div>
  )
}

