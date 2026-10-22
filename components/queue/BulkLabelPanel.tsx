'use client'
import { workspaceApi } from '@/lib/workspace/urls'
import { useState } from 'react'
import TaxonomyBrowser, { type Taxonomy, type SelectedLabel } from '../TaxonomyBrowser'
import { useActiveTaxonomies } from '@/components/labeling/data'
import ResizablePanel from '../ResizablePanel'
import { useDialog } from '../Modal'
import { getUnknownCodeForLevel, isUnknownNodeCode } from '@/lib/constants'
import { SaveOperation } from '@/lib/save-operation'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'
import { Check, ChevronsRight, CircleHelp, Flag, MessageSquare, X } from 'lucide-react'

interface BulkLabelPanelProps {
  sentenceIds: string[]
  onClose: () => void
  onSuccess: () => void
  /** The records were labelled or skipped (they left the open-work view): the queue clears its selection. */
  onComplete?: () => void
}

export default function BulkLabelPanel({ sentenceIds, onClose, onSuccess, onComplete }: BulkLabelPanelProps) {
  const dialog = useDialog(onClose, 'Bulk label')
  const taxonomies: Taxonomy[] = useActiveTaxonomies().data ?? []
  const [activeTaxonomyIndex, setActiveTaxonomyIndex] = useState(0)
  const [selectedLabels, setSelectedLabels] = useState<SelectedLabel[]>([])
  const [saveOperation] = useState(() => new SaveOperation())
  const [comment, setComment] = useState('')
  const [showCommentDialog, setShowCommentDialog] = useState(false)
  const [flagged, setFlagged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [labelingStartedAt] = useState<Date>(new Date()) // Record when bulk panel opened

  const [currentTaxonomyLevel, setCurrentTaxonomyLevel] = useState(1) // Current level being viewed in TaxonomyBrowser

  // Get active taxonomy
  const activeTaxonomy = taxonomies[activeTaxonomyIndex] || null

  const actionButtonBaseClass = 'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors'
  const primaryActionClasses = 'bg-indigo-600 text-white hover:bg-indigo-700'
  const commentActiveClasses = 'bg-[#A7ACD9] text-[#1f2238] hover:bg-[#9ea3cf]'
  const flagActiveClasses = 'bg-[#F56476] text-[#3b0a12] hover:bg-[#e8576a]'
  const disabledSubmitClasses = 'bg-indigo-600/40 text-white/85 cursor-not-allowed'

  // Handle taxonomy tab change
  const handleTaxonomyTabChange = (index: number) => {
    if (index < 0 || index >= taxonomies.length) return
    setActiveTaxonomyIndex(index)
    setCurrentTaxonomyLevel(1) // Reset to level 1 when switching taxonomies
    setSelectedLabels([]) // Clear labels when switching tabs
  }

  // Check if we have a leaf or unknown selected
  const hasLeafOrUnknown = selectedLabels.some(l => l.isLeaf || isUnknownNodeCode(l.nodeCode))
  const canSubmit = hasLeafOrUnknown && !submitting

  const getTabColors = (index: number) => {
    const colors = [
      { active: 'text-teal-600' },
      { active: 'text-[#3A67BB]' },
      { active: 'text-[#A14A76]' },
      { active: 'text-rose-600' },
      { active: 'text-orange-600' }
    ]
    return colors[index % colors.length] ?? colors[0]!
  }

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

  // Handle Flag - toggle and save immediately
  const handleFlag = async () => {
    const newFlaggedState = !flagged
    setFlagged(newFlaggedState)

    // Save flag state immediately for all sentences
    try {
      const responses = await Promise.all(
        sentenceIds.map(id =>
          fetch(workspaceApi(`/sentences/${id}/annotations`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'pending', // Keep current status
              annotations: [],
              flagged: newFlaggedState
            })
          })
        )
      )

      // Check if all requests succeeded
      const allSucceeded = responses.every(r => r.ok)
      if (!allSucceeded) {
        throw new Error('Some flag updates failed')
      }

      // Refresh the queue to show updated flags
      if (onSuccess) {
        onSuccess()
      }
    } catch (error) {
      console.error('Failed to update flags:', error)
      alert('Failed to update flags. Please try again.')
    }
  }

  // Handle Skip (mark all as skipped and close)
  const handleSkip = async () => {
    try {
      setSubmitting(true)

      // Update all sentences to skipped status
      // Note: flags and comments are already saved immediately when clicked/entered
      for (const id of sentenceIds) {
        await fetch(workspaceApi(`/sentences/${id}/annotations`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'skipped',
            annotations: [],
            labelingStartedAt: labelingStartedAt.toISOString()
          })
        })
      }

      onSuccess()
      onComplete?.()
      onClose()
    } catch (error) {
      console.error('Failed to skip sentences:', error)
      alert('Failed to skip sentences')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Submit
  const handleSubmit = async () => {
    if (!hasLeafOrUnknown || !activeTaxonomy) {
      alert('Please select a complete path or mark as unknown')
      return
    }

    try {
      setSubmitting(true)

      // Prepare annotations (including unknown as -99)
      const annotations = selectedLabels.map(l => ({
        level: l.level,
        nodeCode: l.nodeCode // -99 for unknown
      }))

      // Call bulk label API
      // Note: flags and comments are already saved immediately when clicked/entered
      const payload: {
        sentenceIds: string[]
        taxonomyKey: string
        labelingStartedAt: string
        annotations?: Array<{ level: number; nodeCode: string }>
        operationId: string
      } = {
        sentenceIds,
        taxonomyKey: activeTaxonomy.key,
        labelingStartedAt: labelingStartedAt.toISOString(),
        // Sending the same labels again after a failure is the same save.
        operationId: saveOperation.idFor(JSON.stringify([sentenceIds, activeTaxonomy.key, annotations]))
      }

      if (annotations.length > 0) {
        payload.annotations = annotations
      }

      const res = await fetch(workspaceApi('/sentences/bulk-label'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Bulk label failed')
      }
      saveOperation.succeeded()

      // Move to next taxonomy or close if all done
      const nextIndex = activeTaxonomyIndex + 1
      if (nextIndex < taxonomies.length) {
        handleTaxonomyTabChange(nextIndex)
        setSubmitting(false)
        // Don't close, just move to next taxonomy
      } else {
        // All taxonomies done, close panel
        onSuccess()
        onComplete?.()
        onClose()
      }
    } catch (error) {
      console.error('Failed to label sentences:', error)
      alert(error instanceof Error ? error.message : 'Failed to label sentences')
      setSubmitting(false)
    }
  }

  if (taxonomies.length === 0) {
    return (
      <div {...dialog} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 focus:outline-none">
        <div className={`${dialogPanelClass} p-6`}>
          <div className="text-gray-900">Loading taxonomies…</div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Slide-in Panel */}
      <div
        {...dialog}
        className="fixed inset-y-0 right-0 z-50 flex focus:outline-none"
        style={{ width: '100vw', pointerEvents: 'none' }}
      >
        <div className="flex-1" style={{ pointerEvents: 'none' }} />
        <ResizablePanel
          defaultWidth={50}
          minWidth={30}
          maxWidth={70}
          side="right"
          storageKey="bulk-label-panel-width"
          className="bg-white border-l border-gray-900 shadow-2xl flex flex-col"
          style={{ pointerEvents: 'auto' }}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Bulk label</h2>
              <p className="text-sm text-gray-600 mt-1">
                Labeling {sentenceIds.length} {sentenceIds.length === 1 ? 'sentence' : 'sentences'}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-900 transition-colors">
              <X className="w-6 h-6" aria-hidden="true" />
            </button>
          </div>

          {/* Taxonomy Tabs */}
          {taxonomies.length > 1 && (
            <div className="bg-white border-b border-gray-200">
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
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Taxonomy Browser */}
          {activeTaxonomy && (
            <div
              className={`flex-1 overflow-y-auto ${
                taxonomies.length > 1 ? 'border-t border-gray-200 bg-white -mt-px' : ''
              }`}
            >
              <TaxonomyBrowser
                key={activeTaxonomy.key} // Force remount when taxonomy changes to reset navigation state
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
          <div className="p-4 bg-white">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setShowCommentDialog(true)}
                className={`${actionButtonBaseClass} ${comment ? commentActiveClasses : primaryActionClasses}`}
                title="Add comment"
              >
                <MessageSquare className="w-4 h-4" aria-hidden="true" />
                <span className="text-sm font-medium">Comment</span>
              </button>
              <button
                onClick={handleFlag}
                className={`${actionButtonBaseClass} ${flagged ? flagActiveClasses : primaryActionClasses}`}
                title={flagged ? 'Unflag all selected sentences' : 'Flag all selected sentences'}
              >
                <Flag className="w-4 h-4" aria-hidden="true" />
                <span className="text-sm font-medium">Flag</span>
              </button>
              <button
                onClick={handleUnknown}
                className={`${actionButtonBaseClass} ${primaryActionClasses}`}
                title="Unknown"
              >
                <CircleHelp className="w-4 h-4" aria-hidden="true" />
                <span className="text-sm font-medium">Unknown</span>
              </button>
              <button
                onClick={handleSkip}
                disabled={submitting}
                className={`${actionButtonBaseClass} ${
                  submitting ? disabledSubmitClasses : primaryActionClasses
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Skip"
              >
                <ChevronsRight className="w-4 h-4" aria-hidden="true" />
                <span className="text-sm font-medium">Skip</span>
              </button>
              <button
                onClick={handleSubmit}
                disabled={!hasLeafOrUnknown || submitting}
                className={`ml-auto flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                  canSubmit ? primaryActionClasses : disabledSubmitClasses
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Submit"
              >
                <span className="text-sm font-medium">
                  {submitting ? 'Submitting...' : `Submit (${sentenceIds.length})`}
                </span>
                <Check className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </ResizablePanel>
      </div>

      {/* Comment Dialog */}
      {showCommentDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className={`${dialogPanelClass} p-6 w-[32rem]`}>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Add comment</h3>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="This comment will be added to all selected sentences..."
              className="w-full p-3 border border-gray-500 rounded-md h-32 text-gray-900 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-indigo-500"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCommentDialog(false)} className={buttonClass('secondary')}>
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (comment.trim()) {
                    try {
                      // Save comment to all selected sentences immediately
                      const responses = await Promise.all(
                        sentenceIds.map(id =>
                          fetch(workspaceApi(`/sentences/${id}/comments`), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ body: comment.trim() })
                          })
                        )
                      )

                      // Check if all requests succeeded
                      const allSucceeded = responses.every(r => r.ok)
                      if (!allSucceeded) {
                        throw new Error('Some comment saves failed')
                      }

                      // Refresh the queue to show updated comments
                      if (onSuccess) {
                        onSuccess()
                      }
                    } catch (error) {
                      console.error('Failed to save comments:', error)
                      alert('Failed to save comments. Please try again.')
                    }
                  }
                  setShowCommentDialog(false)
                }}
                className={buttonClass('primary')}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
