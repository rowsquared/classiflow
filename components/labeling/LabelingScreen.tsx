'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/query/fetch'
import PageHeader from '@/components/PageHeader'
import TaxonomyBrowser from '@/components/TaxonomyBrowser'
import { ToastContainer, type Toast } from '@/components/Toast'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { queryKeys } from '@/lib/query/keys'
import {
  canSubmitLabels,
  completedTaxonomyKeys,
  labelsFromAnnotations,
  labelsSignature,
  withUnknownAt,
  type SelectedLabel
} from '@/lib/labeling'
import { readNavigationList, storeNavigationList } from '@/lib/labeling-navigation'
import { useUnsavedChanges } from '@/lib/unsaved-changes'
import { SaveOperation } from '@/lib/save-operation'
import { useActiveTaxonomies, useComments, useRecord, type LabelingRecord } from './data'
import RecordPanel from './RecordPanel'
import ActionBar from './ActionBar'
import CommentsDialog from './CommentsDialog'
import { buttonClass } from '@/components/ui/styles'

// Tab colours per taxonomy index (match TaxonomyBrowser's chips).
const TAB_COLORS = ['text-teal-600', 'text-[#3A67BB]', 'text-[#A14A76]', 'text-rose-600', 'text-orange-600']

type AnnotationResponse = { status?: string; completedTaxonomies?: string[]; allCompleted?: boolean; error?: string }

/**
 * Labelling one record. Mounted with `key={sentenceId}` by the page, so every
 * record starts with fresh state (selection, tab, dialogs).
 */
export default function LabelingScreen({ sentenceId, listKey }: { sentenceId: string; listKey: string | null }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { workspaceId, api, href } = useWorkspacePaths()
  const recordKey = queryKeys.sentence(workspaceId, sentenceId)

  // Previous/next through the queue page this record was opened from.
  const [navigation] = useState(() => readNavigationList(listKey, sentenceId))
  const { sentenceIds, currentIndex } = navigation

  const recordQuery = useRecord(sentenceId)
  const taxonomiesQuery = useActiveTaxonomies()
  const sentence = recordQuery.data ?? null
  const taxonomies = taxonomiesQuery.data ?? []

  const [activeTaxonomyIndex, setActiveTaxonomyIndex] = useState(0)
  const activeTaxonomy = taxonomies[activeTaxonomyIndex] ?? null
  // The labels being chosen for the active taxonomy. Until the user changes
  // something they are the record's saved labels (or its AI suggestion).
  const [drafts, setDrafts] = useState<Record<string, SelectedLabel[]>>({})
  const savedLabels = sentence && activeTaxonomy ? labelsFromAnnotations(sentence.annotations, activeTaxonomy.key) : []
  const draft = activeTaxonomy ? drafts[activeTaxonomy.key] : undefined
  const selectedLabels = draft ?? savedLabels
  // Chosen but not submitted: the workspace switcher asks before leaving.
  useUnsavedChanges(
    Object.entries(drafts).some(
      ([key, labels]) =>
        labelsSignature(labels) !== labelsSignature(labelsFromAnnotations(sentence?.annotations ?? [], key))
    )
  )
  const setSelectedLabels = useCallback(
    (labels: SelectedLabel[]) => {
      if (activeTaxonomy) setDrafts(previous => ({ ...previous, [activeTaxonomy.key]: labels }))
    },
    [activeTaxonomy]
  )
  // The level the taxonomy browser shows (where "Unknown" applies).
  const [currentTaxonomyLevel, setCurrentTaxonomyLevel] = useState(1)
  // Completion as the server reported it after the last save, until the record reloads.
  const [savedCompletion, setSavedCompletion] = useState<Set<string> | null>(null)
  const completedTaxonomies =
    savedCompletion ??
    (sentence
      ? completedTaxonomyKeys(
          sentence.annotations,
          taxonomies.map(t => t.key)
        )
      : new Set<string>())

  const [labelingStartedAt] = useState(() => new Date().toISOString())
  const [isNavigatingBack, setIsNavigatingBack] = useState(false)

  // Comments
  const [showCommentDialog, setShowCommentDialog] = useState(false)
  const [commentsRequested, setCommentsRequested] = useState(false)
  const [showResolvedComments, setShowResolvedComments] = useState(false)
  const commentsQuery = useComments(sentenceId, showResolvedComments, commentsRequested)
  const comments = commentsQuery.data?.comments ?? []
  const hasComment = commentsQuery.data
    ? comments.some(c => !c.resolved)
    : Boolean(sentence && ((sentence._count?.comments ?? 0) > 0 || (sentence.comments?.length ?? 0) > 0))

  // Failures are shown as toasts (kept for 10 s) instead of blocking dialogs.
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastCounter = useRef(0)
  const showError = (message: string) => {
    const id = `toast-${toastCounter.current++}`
    setToasts(prev => [...prev, { id, type: 'error', message, duration: 10_000 }])
  }
  const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  useEffect(() => {
    router.prefetch?.(href('/queue'))
  }, [router, href])

  // Warm the annotations route so the first flag/submit is not delayed by compilation.
  useEffect(() => {
    const controller = new AbortController()
    fetch(api(`/sentences/${sentenceId}/annotations`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-warmup': '1' },
      body: '{}',
      signal: controller.signal
    }).catch(() => {
      // Ignore warmup errors - real requests will still work
    })
    return () => controller.abort()
  }, [api, sentenceId])

  const updateRecord = (patch: Partial<LabelingRecord>) =>
    queryClient.setQueryData<LabelingRecord>(recordKey, old => (old ? { ...old, ...patch } : old))
  // Labels, flags and statuses changed: the queue's lists and counts are out of date.
  const invalidateQueue = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.queue(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.progress(workspaceId) })
    ])

  const [saveOperation] = useState(() => new SaveOperation())
  const annotationMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson<AnnotationResponse>(api(`/sentences/${sentenceId}/annotations`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
  })
  const saving = annotationMutation.isPending

  const openComments = () => {
    setCommentsRequested(true)
    // Opening the dialog always shows the current comments.
    if (commentsRequested) {
      queryClient.invalidateQueries({ queryKey: [...recordKey, 'comments'] })
    }
    setShowCommentDialog(true)
  }

  const commentRequest = async (method: 'POST' | 'PATCH' | 'DELETE', body: unknown, failure: string) => {
    try {
      const res = await fetch(api(`/sentences/${sentenceId}/comments`), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        showError(failure)
        return false
      }
      await queryClient.invalidateQueries({ queryKey: [...recordKey, 'comments'] })
      invalidateQueue()
      return true
    } catch (error) {
      console.error(failure, error)
      showError(failure)
      return false
    }
  }

  const handleUnknown = () => {
    if (!activeTaxonomy) return
    setSelectedLabels(withUnknownAt(selectedLabels, activeTaxonomy.key, currentTaxonomyLevel))
  }

  const handleTaxonomyTabChange = (index: number) => {
    if (index < 0 || index >= taxonomies.length) return
    setActiveTaxonomyIndex(index)
    setCurrentTaxonomyLevel(1)
  }

  const goToQueue = () => router.push(href('/queue'))

  const navigateToSentence = (targetIndex: number) => {
    const targetId = sentenceIds[targetIndex]
    if (targetId === undefined) {
      goToQueue()
      return
    }
    const params = new URLSearchParams({ list: storeNavigationList(sentenceIds, targetIndex) })
    router.push(href(`/queue/${targetId}?${params}`))
  }

  const handlePrevious = () => {
    if (currentIndex > 0) navigateToSentence(currentIndex - 1)
  }

  // The next record of the list, or back to the queue at the end.
  const handleNext = () => {
    if (currentIndex >= 0 && currentIndex < sentenceIds.length - 1) navigateToSentence(currentIndex + 1)
    else goToQueue()
  }

  const handleFlag = async () => {
    if (!sentence || saving) return
    try {
      await annotationMutation.mutateAsync({ status: 'pending', annotations: [], flagged: !sentence.flagged })
      updateRecord({ flagged: !sentence.flagged })
      invalidateQueue()
    } catch {
      showError('Failed to update flag. Please try again.')
    }
  }

  const handleSkip = async () => {
    if (saving) return
    try {
      await annotationMutation.mutateAsync({ status: 'skipped', annotations: [], labelingStartedAt })
      updateRecord({ status: 'skipped' })
      invalidateQueue()
      handleNext()
    } catch {
      showError('Failed to skip record. Please try again.')
    }
  }

  const canSubmit = canSubmitLabels(selectedLabels, activeTaxonomy?.maxDepth)

  const handleSubmit = async () => {
    if (saving) return
    if (!canSubmit || !activeTaxonomy) {
      showError('Please select a complete path or mark as unknown')
      return
    }

    try {
      const annotations = selectedLabels.map(l => ({
        level: l.level,
        nodeCode: l.nodeCode, // level-specific unknown codes included
        taxonomyKey: activeTaxonomy.key
      }))
      const data = await annotationMutation.mutateAsync({
        status: 'submitted', // The server keeps 'pending' until every taxonomy is done
        annotations,
        labelingStartedAt,
        // Sending the same labels again after a failure is the same save.
        operationId: saveOperation.idFor(JSON.stringify([sentenceId, annotations]))
      })
      saveOperation.succeeded()

      if (data.status) updateRecord({ status: data.status })
      if (data.completedTaxonomies) setSavedCompletion(new Set(data.completedTaxonomies))
      invalidateQueue()
      // Saved labels of the other tabs come from the record: reload it.
      queryClient.invalidateQueries({ queryKey: recordKey, exact: true })

      // Visit any unfinished taxonomy, including one before the current tab.
      const nextIndex = taxonomies.findIndex(t => !(data.completedTaxonomies ?? []).includes(t.key))
      if (!data.allCompleted && nextIndex >= 0) {
        handleTaxonomyTabChange(nextIndex)
      } else {
        // Every taxonomy is done: on to the next record of the list.
        handleNext()
      }
    } catch (error) {
      console.error('Failed to submit:', error)
      showError(error instanceof Error ? error.message : 'Failed to submit annotations')
    }
  }

  // Keyboard shortcuts. The handler is refreshed after every render so it always
  // sees current state; the listener itself is registered once.
  const handleKeyPressRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    handleKeyPressRef.current = (e: KeyboardEvent) => {
      if (saving || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.target instanceof HTMLElement) {
        // Shortcuts are for the labeling screen, not for an open dialog.
        if (e.target.closest('[role="dialog"], [contenteditable="true"], [role="combobox"], select')) return
        // Enter on a focused control activates that control, not Submit.
        if (e.key === 'Enter' && e.target.closest('button, a, select, [role="button"]')) return
      }

      switch (e.key.toLowerCase()) {
        case 'c':
          openComments()
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
          if (canSubmit) handleSubmit()
          break
      }
    }
  })
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => handleKeyPressRef.current(e)
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [])

  const message = (text: string, tone: 'muted' | 'error', retry?: () => void) => (
    <>
      <PageHeader title="Labeling" />
      <div className="flex flex-col gap-3 items-center justify-center min-h-[calc(100vh-66px)]">
        <div
          role={tone === 'error' ? 'alert' : 'status'}
          className={tone === 'error' ? 'text-red-700' : 'text-gray-600'}
        >
          {text}
        </div>
        {retry && (
          <button className={buttonClass('secondary')} onClick={retry}>
            Retry
          </button>
        )}
      </div>
    </>
  )

  if (recordQuery.isPending || taxonomiesQuery.isPending) return message('Loading...', 'muted')
  if (recordQuery.isError || taxonomiesQuery.isError)
    return message('Could not load the labeling screen. Please try again.', 'error', () => {
      recordQuery.refetch()
      taxonomiesQuery.refetch()
    })
  if (!sentence) return message('Sentence not found', 'error')
  if (taxonomies.length === 0) return message('No active taxonomies found', 'error')

  const isActiveTaxonomyCompleted = activeTaxonomy ? completedTaxonomies.has(activeTaxonomy.key) : false

  const backButton = (
    <button
      onClick={() => {
        if (isNavigatingBack) return
        setIsNavigatingBack(true)
        goToQueue()
      }}
      disabled={isNavigatingBack || saving}
      className={buttonClass('secondary')}
    >
      ← {isNavigatingBack ? 'Loading queue…' : 'Back to queue'}
    </button>
  )

  return (
    <>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <PageHeader title="Labeling" actions={backButton} />
      <div className="h-[calc(100vh-66px)] bg-gray-50 flex overflow-hidden">
        <RecordPanel
          record={sentence}
          navigation={navigation}
          onPrevious={handlePrevious}
          onNext={handleNext}
          disabled={saving}
        />

        {/* Right Panel - Taxonomy */}
        <div className="flex-1 bg-white relative flex flex-col overflow-hidden">
          {taxonomies.length > 1 && (
            <div className="bg-white">
              <div className="flex items-center justify-between px-4 pt-3">
                <div className="flex gap-1" role="group" aria-label="Taxonomies">
                  {taxonomies.map((tax, index) => {
                    const color = TAB_COLORS[index % TAB_COLORS.length]
                    const active = activeTaxonomyIndex === index
                    return (
                      <button
                        key={tax.key}
                        disabled={saving}
                        onClick={() => handleTaxonomyTabChange(index)}
                        aria-pressed={active}
                        className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative ${
                          active
                            ? `bg-white ${color} border border-gray-200 border-b-0 -mb-px`
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                      >
                        {tax.key}
                        {completedTaxonomies.has(tax.key) && (
                          <span className={`ml-2 ${color}`} aria-label="completed">
                            ✓
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                <div className="text-xs text-gray-600 font-medium">
                  {completedTaxonomies.size}/{taxonomies.length} taxonomies completed
                </div>
              </div>
            </div>
          )}

          {activeTaxonomy && (
            <div
              className={`${taxonomies.length > 1 ? 'border-t border-gray-200 bg-white -mt-px' : ''} flex-1 overflow-y-auto`}
            >
              <TaxonomyBrowser
                key={activeTaxonomy.key}
                disabled={saving}
                taxonomy={activeTaxonomy}
                selectedLabels={selectedLabels}
                onLabelsChange={setSelectedLabels}
                taxonomyIndex={activeTaxonomyIndex}
                onCurrentLevelChange={setCurrentTaxonomyLevel}
                showTabs={taxonomies.length > 1}
              />
            </div>
          )}

          <ActionBar
            saving={saving}
            hasComment={hasComment}
            flagged={sentence.flagged}
            skipped={sentence.status === 'skipped'}
            canSubmit={canSubmit}
            submitted={isActiveTaxonomyCompleted || sentence.status === 'submitted'}
            onComment={openComments}
            onFlag={handleFlag}
            onUnknown={handleUnknown}
            onSkip={handleSkip}
            onSubmit={handleSubmit}
          />
        </div>
      </div>

      {showCommentDialog && (
        <CommentsDialog
          loading={commentsQuery.isPending}
          error={commentsQuery.isError}
          onRetry={() => commentsQuery.refetch()}
          comments={comments}
          showResolved={showResolvedComments}
          hasResolved={Boolean(commentsQuery.data?.hasResolved)}
          onToggleShowResolved={() => setShowResolvedComments(!showResolvedComments)}
          onResolve={(commentId, resolved) =>
            commentRequest('PATCH', { commentId, resolved }, 'Failed to update comment. Please try again.')
          }
          onDelete={commentId => commentRequest('DELETE', { commentId }, 'Failed to delete comment. Please try again.')}
          onAdd={body => commentRequest('POST', { body }, 'Failed to save comment. Please try again.')}
          onClose={() => setShowCommentDialog(false)}
        />
      )}
    </>
  )
}
