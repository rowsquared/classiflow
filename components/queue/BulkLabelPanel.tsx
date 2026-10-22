'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import TaxonomyBrowser, { type SelectedLabel } from '../TaxonomyBrowser'
import { useActiveTaxonomies } from '@/components/labeling/data'
import ResizablePanel from '../ResizablePanel'
import Modal, { useDialog } from '../Modal'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { fetchJson } from '@/lib/query/fetch'
import { canSubmitLabels, withUnknownAt } from '@/lib/labeling'
import { SaveOperation } from '@/lib/save-operation'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'
import { Check, ChevronsRight, CircleHelp, Flag, MessageSquare, X } from 'lucide-react'

interface BulkLabelPanelProps {
  sentenceIds: string[]
  onClose: () => void
  onSuccess: () => void
  onComplete?: () => void
}

export default function BulkLabelPanel({ sentenceIds, onClose, onSuccess, onComplete }: BulkLabelPanelProps) {
  const { api } = useWorkspacePaths()
  const taxonomyQuery = useActiveTaxonomies()
  const taxonomies = taxonomyQuery.data ?? []
  const [activeTaxonomyIndex, setActiveTaxonomyIndex] = useState(0)
  const activeTaxonomy = taxonomies[activeTaxonomyIndex]
  const [drafts, setDrafts] = useState<Record<string, SelectedLabel[]>>({})
  const selectedLabels = activeTaxonomy ? (drafts[activeTaxonomy.key] ?? []) : []
  const setSelectedLabels = (labels: SelectedLabel[]) => {
    if (activeTaxonomy) setDrafts(previous => ({ ...previous, [activeTaxonomy.key]: labels }))
  }
  const [completed, setCompleted] = useState<Set<string>>(new Set())
  const [saveOperation] = useState(() => new SaveOperation())
  const [labelingStartedAt] = useState(() => new Date().toISOString())
  const [currentTaxonomyLevel, setCurrentTaxonomyLevel] = useState(1)
  const [comment, setComment] = useState('')
  const [hasComment, setHasComment] = useState(false)
  const [showCommentDialog, setShowCommentDialog] = useState(false)
  const [flagged, setFlagged] = useState(false)
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson(api('/sentences/bulk-label'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentenceIds, taxonomyKey: activeTaxonomy?.key, ...body })
      })
  })
  const submitting = mutation.isPending
  const close = () => {
    if (!submitting) onClose()
  }
  const dialog = useDialog(close, 'Bulk label')

  const changeTaxonomy = (index: number) => {
    setActiveTaxonomyIndex(index)
    setCurrentTaxonomyLevel(1)
  }
  const save = async (body: Record<string, unknown>) => {
    if (submitting || !activeTaxonomy) return false
    setError('')
    try {
      await mutation.mutateAsync(body)
      onSuccess()
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save changes. Please try again.')
      return false
    }
  }
  const handleSubmit = async () => {
    if (!activeTaxonomy || !canSubmitLabels(selectedLabels, activeTaxonomy.maxDepth)) return
    const annotations = selectedLabels.map(({ level, nodeCode }) => ({ level, nodeCode }))
    if (
      !(await save({
        annotations,
        labelingStartedAt,
        operationId: saveOperation.idFor(JSON.stringify([sentenceIds, activeTaxonomy.key, annotations]))
      }))
    )
      return
    saveOperation.succeeded()
    const done = new Set(completed).add(activeTaxonomy.key)
    setCompleted(done)
    const next = taxonomies.findIndex(t => !done.has(t.key))
    if (next >= 0) changeTaxonomy(next)
    else {
      onComplete?.()
      onClose()
    }
  }
  const handleSkip = async () => {
    if (await save({ status: 'skipped', labelingStartedAt })) {
      onComplete?.()
      onClose()
    }
  }
  const handleFlag = async () => {
    if (await save({ flagged: !flagged })) setFlagged(!flagged)
  }
  const handleComment = async () => {
    if (!comment.trim()) return
    if (await save({ comment: comment.trim() })) {
      setHasComment(true)
      setComment('')
      setShowCommentDialog(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={close} />
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
          className="bg-white border-l border-gray-200 shadow-2xl flex flex-col"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Bulk label</h2>
              <p className="text-sm text-gray-600 mt-1">
                Labeling {sentenceIds.length} {sentenceIds.length === 1 ? 'sentence' : 'sentences'}
              </p>
            </div>
            <button
              onClick={close}
              disabled={submitting}
              aria-label="Close bulk label"
              className={buttonClass('ghost', 'sm')}
            >
              <X className="w-6 h-6" aria-hidden="true" />
            </button>
          </div>
          {error && (
            <div role="alert" className="m-4 p-3 text-sm text-red-800 bg-red-50 border border-red-200">
              {error}
            </div>
          )}
          {taxonomyQuery.isPending ? (
            <p role="status" className="p-6 text-gray-600">
              Loading taxonomies…
            </p>
          ) : taxonomyQuery.isError ? (
            <div role="alert" className="p-6 text-red-700">
              Could not load taxonomies.{' '}
              <button className={buttonClass('secondary')} onClick={() => taxonomyQuery.refetch()}>
                Retry
              </button>
            </div>
          ) : !taxonomies.length ? (
            <p className="p-6 text-gray-600">No active taxonomies available.</p>
          ) : (
            <>
              {taxonomies.length > 1 && (
                <div role="group" aria-label="Taxonomies" className="flex gap-1 p-4 border-b border-gray-200">
                  {taxonomies.map((tax, index) => (
                    <button
                      key={tax.key}
                      disabled={submitting}
                      aria-pressed={index === activeTaxonomyIndex}
                      onClick={() => changeTaxonomy(index)}
                      className={buttonClass(index === activeTaxonomyIndex ? 'secondary' : 'ghost', 'sm')}
                    >
                      {tax.key}
                      {completed.has(tax.key) && <span aria-label="completed"> ✓</span>}
                    </button>
                  ))}
                </div>
              )}
              {activeTaxonomy && (
                <div className="flex-1 overflow-y-auto">
                  <TaxonomyBrowser
                    key={activeTaxonomy.key}
                    taxonomy={activeTaxonomy}
                    selectedLabels={selectedLabels}
                    onLabelsChange={setSelectedLabels}
                    taxonomyIndex={activeTaxonomyIndex}
                    onCurrentLevelChange={setCurrentTaxonomyLevel}
                    showTabs={taxonomies.length > 1}
                    disabled={submitting}
                  />
                </div>
              )}
              <div className="p-4 bg-white border-t border-gray-200 flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowCommentDialog(true)}
                  disabled={submitting}
                  className={buttonClass('secondary')}
                  aria-pressed={hasComment}
                >
                  <MessageSquare className="w-4 h-4" aria-hidden="true" />
                  Comment
                </button>
                <button
                  onClick={handleFlag}
                  disabled={submitting}
                  className={buttonClass('secondary')}
                  aria-pressed={flagged}
                  title={flagged ? 'Unflag all selected sentences' : 'Flag all selected sentences'}
                >
                  <Flag className="w-4 h-4" aria-hidden="true" />
                  Flag
                </button>
                <button
                  onClick={() =>
                    activeTaxonomy &&
                    setSelectedLabels(withUnknownAt(selectedLabels, activeTaxonomy.key, currentTaxonomyLevel))
                  }
                  disabled={submitting}
                  className={buttonClass('secondary')}
                >
                  <CircleHelp className="w-4 h-4" aria-hidden="true" />
                  Unknown
                </button>
                <button onClick={handleSkip} disabled={submitting} className={buttonClass('secondary')}>
                  <ChevronsRight className="w-4 h-4" aria-hidden="true" />
                  Skip
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !canSubmitLabels(selectedLabels, activeTaxonomy?.maxDepth)}
                  className={`${buttonClass('primary')} ml-auto`}
                >
                  {submitting ? 'Saving…' : `Submit (${sentenceIds.length})`}
                  <Check className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </ResizablePanel>
      </div>
      {showCommentDialog && (
        <Modal
          label="Add comment"
          onClose={() => {
            if (!submitting) setShowCommentDialog(false)
          }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
        >
          <div className={`${dialogPanelClass} p-6 w-[32rem]`}>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Add comment</h3>
            {error && (
              <p role="alert" className="mb-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <label htmlFor="bulk-comment" className="block text-sm text-gray-700 mb-2">
              Comment for all selected sentences
            </label>
            <textarea
              id="bulk-comment"
              value={comment}
              onChange={e => setComment(e.target.value)}
              disabled={submitting}
              maxLength={10000}
              className="w-full p-3 border border-gray-500 h-32 text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowCommentDialog(false)}
                disabled={submitting}
                className={buttonClass('secondary')}
              >
                Cancel
              </button>
              <button
                onClick={handleComment}
                disabled={submitting || !comment.trim()}
                className={buttonClass('primary')}
              >
                {submitting ? 'Saving…' : 'Save comment'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
