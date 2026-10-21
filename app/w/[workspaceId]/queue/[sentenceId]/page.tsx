'use client'
import { workspaceApi, workspaceHref } from '@/lib/workspace/urls'
import { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import PageHeader from '@/components/PageHeader'
import TaxonomyBrowser, { type Taxonomy, type SelectedLabel } from '@/components/TaxonomyBrowser'
import ResizablePanel from '@/components/ResizablePanel'
import { formatFieldName } from '@/lib/utils'
import { getUnknownCodeForLevel, isUnknownNodeCode } from '@/lib/constants'
import Modal from '@/components/Modal'
import { ToastContainer, type Toast } from '@/components/Toast'

type Sentence = {
  id: string
  field1: string
  field2?: string | null
  field3?: string | null
  field4?: string | null
  field5?: string | null
  support1?: string | null
  support2?: string | null
  support3?: string | null
  support4?: string | null
  support5?: string | null
  fieldMapping: Record<string, string>
  supportMapping?: Record<string, string> | null
  status: string
  flagged: boolean
  lastEditedAt: string | null
  annotations: Array<{
    level: number
    nodeCode: string
    nodeLabel?: string
    nodeDefinition?: string | null
    isLeaf?: boolean
    taxonomy: { key: string }
    source?: 'user' | 'ai'
    confidenceScore?: number
  }>
  _count?: { comments: number }
}

export default function LabelingPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const sentenceId = params.sentenceId as string

  // Get navigation list from sessionStorage (reactive to URL changes)
  const { sentenceIds, currentIndex } = useMemo(() => {
    const storageKey = searchParams.get('list')

    if (storageKey) {
      try {
        const stored = sessionStorage.getItem(storageKey)
        if (stored) {
          const data = JSON.parse(stored)
          // Check if data is not too old (1 hour expiry)
          if (data.timestamp && Date.now() - data.timestamp < 3600000) {
            const ids = data.sentenceIds || []
            let idx = data.currentIndex !== undefined ? parseInt(String(data.currentIndex), 10) : -1

            // Verify that the currentIndex matches the sentenceId
            if (ids.length > 0 && idx >= 0 && idx < ids.length) {
              if (ids[idx] !== sentenceId) {
                const correctIndex = ids.indexOf(sentenceId)
                if (correctIndex >= 0) {
                  idx = correctIndex
                }
              }
            }

            return { sentenceIds: ids, currentIndex: idx }
          }
        }
      } catch (error) {
        console.error('Failed to read sentence list from sessionStorage:', error)
      }
    }

    // No valid list found
    return { sentenceIds: [], currentIndex: -1 }
  }, [searchParams, sentenceId])

  const [sentence, setSentence] = useState<Sentence | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedLabels, setSelectedLabels] = useState<SelectedLabel[]>([])
  const [comment, setComment] = useState('')
  const [showCommentDialog, setShowCommentDialog] = useState(false)
  // Failures are shown as toasts (kept for 10 s) instead of blocking showError() dialogs.
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastCounter = useRef(0)
  const showError = (message: string) => {
    const id = `toast-${toastCounter.current++}`
    setToasts(prev => [...prev, { id, type: 'error', message, duration: 10_000 }])
  }
  const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])
  const [hasComment, setHasComment] = useState(false)
  const [showResolvedComments, setShowResolvedComments] = useState(false)
  const [hasResolvedComments, setHasResolvedComments] = useState(false)
  const [existingComments, setExistingComments] = useState<
    Array<{
      id: string
      body: string
      createdAt: string
      resolved: boolean
      resolvedAt: string | null
      author: { name: string | null }
    }>
  >([])
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([])
  const [activeTaxonomyIndex, setActiveTaxonomyIndex] = useState(0)
  const [completedTaxonomies, setCompletedTaxonomies] = useState<Set<string>>(new Set())
  const [labelingStartedAt] = useState<Date>(new Date()) // Record when user opened this sentence
  const [currentTaxonomyLevel, setCurrentTaxonomyLevel] = useState(1) // Current level being viewed in TaxonomyBrowser
  const [isNavigatingBack, setIsNavigatingBack] = useState(false)
  useEffect(() => {
    router.prefetch?.('/queue')
  }, [router])

  // Get active taxonomy
  const activeTaxonomy = taxonomies[activeTaxonomyIndex] || null

  // Helper function to calculate completed taxonomies from annotations
  // Only treat taxonomies with user-submitted annotations as completed.
  // AI suggestions (source === 'ai') should not mark a taxonomy as completed,
  // otherwise the submit button would appear as "submitted" before a human action.
  const calculateCompletedTaxonomies = (annotations: Sentence['annotations'], taxonomiesList: Taxonomy[]) => {
    const completed = new Set<string>()
    taxonomiesList.forEach(tax => {
      const userAnnotations = annotations.filter(ann => {
        const annotationTaxKey = ann.taxonomy?.key
        const source = ann.source ?? 'user'
        return annotationTaxKey === tax.key && source !== 'ai'
      })
      if (userAnnotations.length > 0) {
        completed.add(tax.key)
      }
    })
    return completed
  }

  // Load all active taxonomies
  useEffect(() => {
    const loadTaxonomies = async () => {
      try {
        const res = await fetch(workspaceApi('/taxonomies/active'))
        if (!res.ok) throw new Error('Failed to fetch taxonomies')
        const data = await res.json()
        if (data.ok && data.taxonomies.length > 0) {
          const loadedTaxonomies = data.taxonomies.map((t: Taxonomy) => ({
            key: t.key,
            maxDepth: t.maxDepth || 5,
            levelNames: t.levelNames
          }))
          setTaxonomies(loadedTaxonomies)
          setActiveTaxonomyIndex(0) // Start with first taxonomy
        }
      } catch (error) {
        console.error('Failed to load taxonomies:', error)
      }
    }
    loadTaxonomies()
  }, [])

  // Warm the annotations API route so the first flag/submit isn't delayed by compilation
  useEffect(() => {
    if (!sentenceId) return
    const controller = new AbortController()
    fetch(workspaceApi(`/sentences/${sentenceId}/annotations`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-warmup': '1'
      },
      body: '{}',
      signal: controller.signal
    }).catch(() => {
      // Ignore warmup errors - real requests will still work
    })
    return () => controller.abort()
  }, [sentenceId])

  // Load sentence data (can load in parallel with taxonomies)
  useEffect(() => {
    if (!sentenceId) return
    const loadSentence = async () => {
      try {
        setLoading(true)
        const res = await fetch(workspaceApi(`/sentences/${sentenceId}`))
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`)
        }
        const data = await res.json()
        setSentence(data)

        // Check if sentence has comments
        const hasExistingComments = data._count?.comments > 0 || (data.comments && data.comments.length > 0)
        setHasComment(hasExistingComments)
      } catch (error) {
        console.error('Failed to load sentence:', error)
        setSentence(null)
      } finally {
        setLoading(false)
      }
    }
    loadSentence()
  }, [sentenceId])

  // Initialize selected labels when both sentence and active taxonomy are available
  const activeTaxonomyKey = activeTaxonomy?.key
  useEffect(() => {
    if (sentence?.annotations && activeTaxonomyKey) {
      const labels: SelectedLabel[] = sentence.annotations
        .filter(ann => ann.taxonomy.key === activeTaxonomyKey)
        .map(ann => ({
          level: ann.level,
          nodeCode: ann.nodeCode,
          taxonomyKey: ann.taxonomy.key,
          label: ann.nodeLabel || '',
          definition: ann.nodeDefinition || undefined,
          isLeaf: ann.isLeaf || false,
          source: ann.source || 'user',
          confidenceScore: ann.confidenceScore
        }))
      setSelectedLabels(labels)

      // If there are AI suggestions, navigate to the lowest level to show it
      const aiLabels = labels.filter(l => l.source === 'ai')
      if (aiLabels.length > 0) {
        // Find the lowest level AI suggestion
        const lowestLevel = Math.max(...aiLabels.map(l => l.level))
        // Set the current level to show the lowest level (TaxonomyBrowser will navigate)
        setCurrentTaxonomyLevel(lowestLevel)
      } else {
        // No AI suggestions, start at level 1
        setCurrentTaxonomyLevel(1)
      }
    }
  }, [sentence, activeTaxonomyKey])

  // Recalculate completed taxonomies whenever sentence annotations or taxonomies change
  useEffect(() => {
    if (sentence?.annotations && taxonomies.length > 0) {
      const completed = calculateCompletedTaxonomies(sentence.annotations, taxonomies)
      setCompletedTaxonomies(completed)
    }
  }, [sentence, taxonomies])

  // Load existing comments
  const loadComments = async (includeResolved = showResolvedComments) => {
    try {
      const res = await fetch(
        workspaceApi(`/sentences/${sentenceId}/comments?includeResolved=${includeResolved ? 'true' : 'false'}`)
      )
      if (res.ok) {
        const data = await res.json()
        setExistingComments(data.comments || [])
        setHasResolvedComments(Boolean(data.hasResolved))
        const hasUnresolved = (data.comments || []).some((c: { resolved: boolean }) => !c.resolved)
        setHasComment(hasUnresolved)
      }
    } catch (error) {
      console.error('Failed to load comments:', error)
    }
  }

  const toggleShowResolvedComments = async () => {
    const nextValue = !showResolvedComments
    setShowResolvedComments(nextValue)
    await loadComments(nextValue)
  }

  const handleResolveComment = async (commentId: string, resolved: boolean) => {
    try {
      const res = await fetch(workspaceApi(`/sentences/${sentenceId}/comments`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, resolved })
      })
      if (!res.ok) {
        console.error('Failed to update comment')
        showError('Failed to update comment. Please try again.')
        return
      }
      await loadComments(showResolvedComments)
    } catch (error) {
      console.error('Failed to update comment:', error)
      showError('Failed to update comment. Please try again.')
    }
  }

  const handleDeleteComment = async (commentId: string) => {
    try {
      const res = await fetch(workspaceApi(`/sentences/${sentenceId}/comments`), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId })
      })
      if (!res.ok) {
        console.error('Failed to delete comment')
        showError('Failed to delete comment. Please try again.')
        return
      }
      await loadComments(showResolvedComments)
    } catch (error) {
      console.error('Failed to delete comment:', error)
      showError('Failed to delete comment. Please try again.')
    }
  }

  // Work only with labels that belong to the currently active taxonomy
  const activeSelectedLabels = activeTaxonomy ? selectedLabels.filter(l => l.taxonomyKey === activeTaxonomy.key) : []

  // Check if we have a leaf or unknown selected for the active taxonomy
  const hasLeafOrUnknown = activeSelectedLabels.some(l => l.isLeaf === true || isUnknownNodeCode(l.nodeCode))

  // Also check if we have AI suggestions with a complete path (all levels from 1 to lowest level)
  const aiLabels = activeSelectedLabels.filter(l => l.source === 'ai')
  const hasCompleteAIPath =
    aiLabels.length > 0 &&
    activeTaxonomy &&
    (() => {
      const maxLevel = Math.max(...aiLabels.map(l => l.level))
      const allLevels = aiLabels.map(l => l.level)
      // Check if we have a complete path (levels 1, 2, 3, ... up to maxLevel)
      const expectedLevels = Array.from({ length: maxLevel }, (_, i) => i + 1)
      const hasCompletePath = expectedLevels.every(level => allLevels.includes(level))
      // Get the lowest level label
      const lowestLabel = aiLabels.find(l => l.level === maxLevel)
      // Only allow AI path to count if the deepest node is a leaf, unknown, or at max depth
      const lowestIsLeafOrUnknown =
        lowestLabel !== undefined &&
        (lowestLabel.isLeaf === true ||
          isUnknownNodeCode(lowestLabel.nodeCode) ||
          lowestLabel.level >= (activeTaxonomy.maxDepth || Number.MAX_SAFE_INTEGER))
      return hasCompletePath && lowestLabel !== undefined && lowestIsLeafOrUnknown
    })()

  const canSubmit = hasLeafOrUnknown || hasCompleteAIPath

  // Handle Unknown
  const handleUnknown = () => {
    // Mark current level as unknown, preserving lower level labels
    if (!activeTaxonomy) return

    // Keep labels at levels below the current level
    const lowerLevelLabels = selectedLabels.filter(
      l => l.taxonomyKey === activeTaxonomy.key && l.level < currentTaxonomyLevel
    )

    // Add unknown at the current level
    const unknownLabel: SelectedLabel = {
      level: currentTaxonomyLevel,
      nodeCode: getUnknownCodeForLevel(currentTaxonomyLevel),
      taxonomyKey: activeTaxonomy.key,
      label: 'Unknown',
      isLeaf: true
    }

    // Combine: lower levels + unknown at current level
    setSelectedLabels([...lowerLevelLabels, unknownLabel])
  }

  // Handle taxonomy tab change
  const handleTaxonomyTabChange = (index: number) => {
    if (index < 0 || index >= taxonomies.length) return
    setActiveTaxonomyIndex(index)
    setCurrentTaxonomyLevel(1) // Reset to level 1 when switching taxonomies

    // Load selected labels for the new taxonomy
    const taxonomy = taxonomies[index]
    if (sentence && taxonomy) {
      const labels: SelectedLabel[] = sentence.annotations
        .filter(ann => ann.taxonomy.key === taxonomy.key)
        .map(ann => ({
          level: ann.level,
          nodeCode: ann.nodeCode,
          taxonomyKey: ann.taxonomy.key,
          label: ann.nodeLabel || '',
          definition: ann.nodeDefinition || undefined,
          isLeaf: ann.isLeaf || false
        }))
      setSelectedLabels(labels)
    } else {
      setSelectedLabels([])
    }
  }

  // Navigate to a sentence in the list
  const navigateToSentence = (targetIndex: number) => {
    if (sentenceIds.length === 0 || targetIndex < 0 || targetIndex >= sentenceIds.length) {
      // No list or out of bounds, go back to queue
      router.push(workspaceHref('/queue'))
      return
    }

    const targetId = sentenceIds[targetIndex]
    const storageKey = `sentence-list-${targetId}`

    // Store list in sessionStorage
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        sentenceIds,
        currentIndex: targetIndex,
        timestamp: Date.now()
      })
    )

    const params = new URLSearchParams()
    params.set('list', storageKey)
    router.push(workspaceHref(`/queue/${targetId}?${params.toString()}`))
  }

  // Navigate to previous sentence in the list
  const handlePrevious = () => {
    if (currentIndex > 0) {
      navigateToSentence(currentIndex - 1)
    }
  }

  // Navigate to next sentence in the list
  const handleNext = () => {
    if (currentIndex >= 0 && currentIndex < sentenceIds.length - 1) {
      navigateToSentence(currentIndex + 1)
    } else {
      // End of list, go back to queue
      router.push(workspaceHref('/queue'))
    }
  }

  // Get next sentence ID from the list (for Submit/Skip)
  const getNextSentenceId = (): string | null => {
    if (sentenceIds.length === 0 || currentIndex < 0) {
      return null
    }
    if (currentIndex < sentenceIds.length - 1) {
      return sentenceIds[currentIndex + 1]
    }
    return null
  }

  // Handle Flag
  const handleFlag = async () => {
    if (!sentence) return
    try {
      const res = await fetch(workspaceApi(`/sentences/${sentenceId}/annotations`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: sentence.status,
          annotations: [],
          flagged: !sentence.flagged
        })
      })
      if (res.ok) {
        setSentence({ ...sentence, flagged: !sentence.flagged })
      }
    } catch (error) {
      console.error('Failed to toggle flag:', error)
    }
  }

  // Handle Skip
  const handleSkip = async () => {
    try {
      const res = await fetch(workspaceApi(`/sentences/${sentenceId}/annotations`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'skipped',
          annotations: [],
          flagged: sentence?.flagged,
          labelingStartedAt: labelingStartedAt.toISOString()
        })
      })
      if (res.ok) {
        // Navigate to next sentence in the list
        const nextId = getNextSentenceId()
        if (nextId && currentIndex >= 0) {
          navigateToSentence(currentIndex + 1)
        } else {
          // No more sentences, go back to queue
          router.push(workspaceHref('/queue'))
        }
      }
    } catch (error) {
      console.error('Failed to skip:', error)
    }
  }

  // Handle Submit
  const handleSubmit = async () => {
    if (!canSubmit || !activeTaxonomy) {
      showError('Please select a complete path or mark as unknown')
      return
    }

    try {
      // Prepare annotations (including unknown as -99)
      const annotations = selectedLabels.map(l => ({
        level: l.level,
        nodeCode: l.nodeCode, // -99 for unknown
        taxonomyKey: activeTaxonomy.key
      }))

      const res = await fetch(workspaceApi(`/sentences/${sentenceId}/annotations`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'submitted', // Will be updated to 'pending' if not all taxonomies done
          annotations,
          flagged: sentence?.flagged,
          labelingStartedAt: labelingStartedAt.toISOString()
        })
      })

      if (res.ok) {
        const responseData = await res.json()

        // Update sentence status from response (avoid full reload)
        if (sentence) {
          setSentence({ ...sentence, status: responseData.status })
        }

        // Update completed taxonomies from response
        if (responseData.completedTaxonomies) {
          setCompletedTaxonomies(new Set(responseData.completedTaxonomies))
        }

        // Check if all taxonomies are completed
        const allCompleted = responseData.allCompleted || false

        if (allCompleted) {
          // All taxonomies done, move to next sentence in the list
          const nextId = getNextSentenceId()
          if (nextId && currentIndex >= 0) {
            navigateToSentence(currentIndex + 1)
          } else {
            // No more sentences, go back to queue
            router.push(workspaceHref('/queue'))
          }
        } else {
          // Move to next taxonomy tab
          const nextIndex = activeTaxonomyIndex + 1
          if (nextIndex < taxonomies.length) {
            handleTaxonomyTabChange(nextIndex)
          } else {
            // All taxonomies done, move to next sentence in the list
            const nextId = getNextSentenceId()
            if (nextId && currentIndex >= 0) {
              navigateToSentence(currentIndex + 1)
            } else {
              router.push(workspaceHref('/queue'))
            }
          }
        }
      } else {
        const data = await res.json()
        showError(`Failed to submit annotations: ${data.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Failed to submit:', error)
      showError('Failed to submit annotations')
    }
  }

  // Keyboard shortcuts. The handler is refreshed after every render so it always
  // sees current state; the listener itself is registered once.
  const handleKeyPressRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    handleKeyPressRef.current = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.target instanceof HTMLElement) {
        // Shortcuts are for the labeling screen, not for an open dialog.
        if (e.target.closest('[role="dialog"]')) return
        // Enter on a focused control activates that control, not Submit.
        if (e.key === 'Enter' && e.target.closest('button, a, select, [role="button"]')) return
      }

      switch (e.key.toLowerCase()) {
        case 'c':
          loadComments(showResolvedComments)
          setShowCommentDialog(true)
          break
        case 'f':
          handleFlag()
          break
        case 'u':
          handleUnknown()
          break
        case 's':
          handleSkip()
          break
        case 'enter':
          if (canSubmit) {
            handleSubmit()
          }
          break
      }
    }
  })
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => handleKeyPressRef.current(e)
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [])

  if (loading) {
    return (
      <>
        <PageHeader title="Labeling" />
        <div className="flex items-center justify-center h-screen">
          <div className="text-gray-600">Loading...</div>
        </div>
      </>
    )
  }

  if (!sentence) {
    return (
      <>
        <PageHeader title="Labeling" />
        <div className="flex items-center justify-center h-screen">
          <div className="text-red-600">Sentence not found</div>
        </div>
      </>
    )
  }

  if (taxonomies.length === 0) {
    return (
      <>
        <PageHeader title="Labeling" />
        <div className="flex items-center justify-center h-screen">
          <div className="text-red-600">No active taxonomies found</div>
        </div>
      </>
    )
  }

  // Calculate progress
  const completedCount = completedTaxonomies.size
  const totalCount = taxonomies.length
  const progressText = `${completedCount}/${totalCount} taxonomies completed`

  const actionButtonBaseClass = 'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors'
  const primaryActionClasses = 'bg-teal-600 text-white hover:bg-teal-700'
  const commentActiveClasses = 'bg-[#A7ACD9] text-[#1f2238] hover:bg-[#9ea3cf]'
  const flagActiveClasses = 'bg-[#F56476] text-white hover:bg-[#e8576a]'
  const skipActiveClasses = 'bg-[#E8E24A] text-[#4a4510] hover:bg-[#d8d145]'
  const disabledSubmitClasses = 'bg-teal-600/40 text-white/85 cursor-not-allowed'
  const submittedSubmitClasses = 'bg-[#3A67BB] text-white hover:bg-[#335aa8]'
  const shortcutClasses = {
    dark: 'text-xs px-1.5 py-0.5 rounded border border-white/15 bg-white/20 text-white',
    light: 'text-xs px-1.5 py-0.5 rounded border border-black/5 bg-white/50 text-current'
  }

  const isSentenceSubmitted = sentence.status === 'submitted'
  const isActiveTaxonomyCompleted = activeTaxonomy ? completedTaxonomies.has(activeTaxonomy.key) : false

  // Get tab colors based on taxonomy index (matches TaxonomyBrowser)
  const getTabColors = (index: number) => {
    const colors = [
      { active: 'text-teal-600', checkmark: 'text-teal-600' }, // Index 0: Primary/Teal
      { active: 'text-[#3A67BB]', checkmark: 'text-[#3A67BB]' }, // Index 1: Submitted blue
      { active: 'text-[#A14A76]', checkmark: 'text-[#A14A76]' }, // Index 2: Rose purple
      { active: 'text-rose-600', checkmark: 'text-rose-600' }, // Index 3: Rose
      { active: 'text-orange-600', checkmark: 'text-orange-600' } // Index 4: Orange
    ]
    return colors[index % colors.length] ?? colors[0]!
  }

  const handleBackToQueue = () => {
    if (isNavigatingBack) return
    setIsNavigatingBack(true)
    router.push(workspaceHref('/queue'))
  }

  const backButton = (
    <button
      onClick={handleBackToQueue}
      disabled={isNavigatingBack}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      ← {isNavigatingBack ? 'Loading Queue…' : 'Back to Queue'}
    </button>
  )

  return (
    <>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <PageHeader title="Labeling" actions={backButton} />
      <div className="h-[calc(100vh-66px)] bg-gray-50 flex overflow-hidden">
        {/* Left Panel - Sentence Fields */}
        <ResizablePanel
          defaultWidth={50}
          minWidth={30}
          maxWidth={70}
          side="left"
          storageKey="labeling-left-panel-width"
          className="bg-white border-r border-gray-200 relative flex flex-col"
        >
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-6">
              {/* Field Columns */}
              {sentence.fieldMapping &&
                Object.entries(sentence.fieldMapping).map(([num, name]) => {
                  const value = sentence[`field${num}` as keyof Sentence] as string | null
                  if (!value) return null

                  return (
                    <div key={num}>
                      <h2 className="text-sm font-semibold text-indigo-700 mb-2">{formatFieldName(name)}</h2>
                      <p className="text-gray-900 whitespace-pre-wrap leading-relaxed text-lg">{value}</p>
                    </div>
                  )
                })}

              {/* Support Columns */}
              {sentence.supportMapping && Object.keys(sentence.supportMapping).length > 0 && (
                <div className="pt-6 border-t border-gray-200">
                  <h2 className="text-base font-semibold text-gray-900 mb-4">Support Information</h2>
                  <div className="space-y-4">
                    {Object.entries(sentence.supportMapping).map(([num, name]) => {
                      const value = sentence[`support${num}` as keyof Sentence] as string | null
                      if (!value) return null

                      return (
                        <div key={num}>
                          <h3 className="text-sm font-semibold text-indigo-700 mb-2">{formatFieldName(name)}</h3>
                          <p className="text-base text-gray-900 whitespace-pre-wrap leading-relaxed">{value}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Navigation Buttons - Bottom Right */}
          <div className="p-4 flex items-center justify-between gap-2 bg-white">
            <div className="flex items-center gap-3 text-xs font-medium text-gray-500">
              {sentenceIds.length > 0 && currentIndex >= 0 ? (
                <>
                  <span>
                    Sentence {currentIndex + 1} of {sentenceIds.length}
                  </span>
                  <div className="w-32 h-1.5 rounded-full bg-gray-200">
                    <div
                      className="h-full rounded-full bg-teal-500 transition-all"
                      style={{ width: `${((currentIndex + 1) / sentenceIds.length) * 100}%` }}
                    />
                  </div>
                </>
              ) : (
                <span>Sentence navigation unavailable</span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePrevious}
                className="p-2 text-gray-600 hover:text-[#008080] hover:bg-[#e6fbf8] rounded-lg transition-colors"
                title="Previous sentence"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={handleNext}
                className="p-2 text-gray-600 hover:text-[#008080] hover:bg-[#e6fbf8] rounded-lg transition-colors"
                title="Next sentence"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </ResizablePanel>

        {/* Right Panel - Taxonomy */}
        <div className="flex-1 bg-white relative flex flex-col overflow-hidden">
          {/* Taxonomy Tabs */}
          {taxonomies.length > 1 && (
            <div className="bg-white">
              <div className="flex items-center justify-between px-4 pt-3">
                <div className="flex gap-1">
                  {taxonomies.map((tax, index) => {
                    const tabColors = getTabColors(index)
                    return (
                      <button
                        key={tax.key}
                        onClick={() => handleTaxonomyTabChange(index)}
                        className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative ${
                          activeTaxonomyIndex === index
                            ? `bg-white ${tabColors.active} border border-gray-200 border-b-0 -mb-px`
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                      >
                        {tax.key}
                        {completedTaxonomies.has(tax.key) && <span className={`ml-2 ${tabColors.checkmark}`}>✓</span>}
                      </button>
                    )
                  })}
                </div>
                <div className="text-xs text-gray-600 font-medium">{progressText}</div>
              </div>
            </div>
          )}

          {/* Taxonomy Browser */}
          {activeTaxonomy && (
            <div
              className={`${
                taxonomies.length > 1 ? 'border-t border-gray-200 bg-white -mt-px' : ''
              } flex-1 overflow-y-auto`}
            >
              <TaxonomyBrowser
                key={`${sentenceId}-${activeTaxonomy.key}`}
                taxonomy={activeTaxonomy}
                selectedLabels={selectedLabels}
                onLabelsChange={setSelectedLabels}
                taxonomyIndex={activeTaxonomyIndex}
                onCurrentLevelChange={setCurrentTaxonomyLevel}
                showTabs={taxonomies.length > 1}
              />
            </div>
          )}

          {/* Sticky Action Buttons */}
          <div className="mt-auto">
            <div className="sticky bottom-0 border-t border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    loadComments(showResolvedComments)
                    setShowCommentDialog(true)
                  }}
                  className={`${actionButtonBaseClass} ${hasComment ? commentActiveClasses : primaryActionClasses}`}
                  title="Add Comment (C)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                  <span className="text-sm font-medium">Comment</span>
                  <span className={`${hasComment ? shortcutClasses.light : shortcutClasses.dark}`}>C</span>
                </button>
                <button
                  onClick={handleFlag}
                  className={`${actionButtonBaseClass} ${sentence.flagged ? flagActiveClasses : primaryActionClasses}`}
                  title="Flag/Unflag (F)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"
                    />
                  </svg>
                  <span className="text-sm font-medium">Flag</span>
                  <span className={`${sentence.flagged ? shortcutClasses.light : shortcutClasses.dark}`}>F</span>
                </button>
                <button
                  onClick={handleUnknown}
                  className={`${actionButtonBaseClass} ${primaryActionClasses}`}
                  title="Unknown (U)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="text-sm font-medium">Unknown</span>
                  <span className={shortcutClasses.dark}>U</span>
                </button>
                <button
                  onClick={handleSkip}
                  className={`${actionButtonBaseClass} ${
                    sentence?.status === 'skipped' ? skipActiveClasses : primaryActionClasses
                  }`}
                  title="Skip (S)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                  <span className="text-sm font-medium">Skip</span>
                  <span className={`${sentence?.status === 'skipped' ? shortcutClasses.light : shortcutClasses.dark}`}>
                    S
                  </span>
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className={`ml-auto flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                    isActiveTaxonomyCompleted || isSentenceSubmitted
                      ? submittedSubmitClasses
                      : canSubmit
                        ? primaryActionClasses
                        : disabledSubmitClasses
                  }`}
                  title="Submit (Enter)"
                >
                  <span className="text-sm font-medium">Submit</span>
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded ${
                      isActiveTaxonomyCompleted || isSentenceSubmitted
                        ? shortcutClasses.dark
                        : canSubmit
                          ? shortcutClasses.dark
                          : `${shortcutClasses.dark} opacity-70 text-white/80`
                    }`}
                  >
                    ↵
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Comment Dialog */}
      {showCommentDialog && (
        <Modal
          label="Comments"
          onClose={() => setShowCommentDialog(false)}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        >
          <div className="bg-white rounded-lg p-6 w-[32rem] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Comments</h3>
              <button
                onClick={() => setShowCommentDialog(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Close comments"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Existing comments</span>
              <button
                onClick={toggleShowResolvedComments}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                {showResolvedComments ? 'Hide resolved' : 'Show resolved'}
              </button>
            </div>
            {!showResolvedComments && hasResolvedComments && (
              <p className="text-xs text-gray-500 mb-3">
                Resolved comments are hidden. Click &quot;Show resolved&quot; to view them.
              </p>
            )}

            {existingComments.length > 0 ? (
              <div className="mb-4 space-y-3 max-h-60 overflow-y-auto pr-1">
                {existingComments.map(c => (
                  <div
                    key={c.id}
                    className={`p-3 rounded-lg border ${
                      c.resolved ? 'bg-gray-100 border-gray-300 opacity-80' : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div>
                        <span className="text-xs font-medium text-gray-700">{c.author.name || 'Unknown'}</span>
                        {c.resolved && <span className="ml-2 text-xs font-semibold text-green-600">Resolved</span>}
                      </div>
                      <span className="text-xs text-gray-500">{new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">{c.body}</p>
                    <div className="flex justify-end gap-2 mt-3">
                      <button
                        onClick={() => handleResolveComment(c.id, !c.resolved)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          c.resolved
                            ? 'border-indigo-200 text-indigo-600 hover:bg-indigo-50'
                            : 'border-green-200 text-green-700 hover:bg-green-50'
                        }`}
                      >
                        {c.resolved ? 'Reopen' : 'Mark resolved'}
                      </button>
                      <button
                        onClick={() => handleDeleteComment(c.id)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 mb-4">
                {showResolvedComments ? 'No comments found.' : 'No unresolved comments yet.'}
              </p>
            )}

            {/* New Comment Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Add new comment:</label>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Enter your comment..."
                className="w-full p-3 border border-gray-300 rounded-md h-24 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCommentDialog(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
              <button
                onClick={async () => {
                  if (!comment.trim()) {
                    setShowCommentDialog(false)
                    return
                  }
                  try {
                    const res = await fetch(workspaceApi(`/sentences/${sentenceId}/comments`), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ body: comment })
                    })
                    if (res.ok) {
                      setHasComment(true)
                      setComment('')
                      await loadComments(showResolvedComments)
                      setShowCommentDialog(false)
                    } else {
                      console.error('Failed to save comment')
                      showError('Failed to save comment. Please try again.')
                    }
                  } catch (error) {
                    console.error('Failed to save comment:', error)
                    showError('Failed to save comment. Please try again.')
                  }
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
