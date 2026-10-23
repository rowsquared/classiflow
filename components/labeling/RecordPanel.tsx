'use client'

import type { ReactNode } from 'react'
import { MessageSquare } from 'lucide-react'
import { CopyRecordLink } from '@/components/CopyRecordLink'
import { buttonClass } from '@/components/ui/styles'
import Tooltip from '@/components/Tooltip'
import ResizablePanel from '@/components/ResizablePanel'
import { formatFieldName } from '@/lib/utils'
import type { NavigationList } from '@/lib/labeling-navigation'
import type { LabelingRecord } from './data'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type RecordPanelProps = {
  disabled?: boolean
  workspaceId: string
  commentsOpen: boolean
  commentSummary: { total: number; unresolved: number }
  onComments: () => void
  discussion: ReactNode
  record: LabelingRecord
  navigation: NavigationList
  onPrevious: () => void
  onNext: () => void
}

/** Left side of the labelling screen: the record's fields and context, and previous/next. */
export default function RecordPanel({
  record,
  navigation,
  onPrevious,
  onNext,
  workspaceId,
  commentsOpen,
  commentSummary,
  onComments,
  discussion,
  disabled = false
}: RecordPanelProps) {
  const { sentenceIds, currentIndex } = navigation
  const fields = Object.entries(record.fieldMapping ?? {}).filter(
    ([num]) => record[`field${num}` as keyof LabelingRecord]
  )
  const resolved = commentSummary.total - commentSummary.unresolved
  const commentsLabel = `Comments: ${commentSummary.unresolved} unresolved; ${resolved} resolved (C)`
  const actions = (
    <div className="flex shrink-0 items-start gap-1">
      <Tooltip
        content={`Comments (C)\n\n${commentSummary.unresolved} unresolved · ${resolved} resolved`}
        delayDuration={300}
      >
        <button
          type="button"
          onClick={onComments}
          aria-label={commentsLabel}
          aria-expanded={commentsOpen}
          aria-controls={commentsOpen ? 'record-comments' : undefined}
          aria-keyshortcuts="C"
          className={buttonClass('ghost', 'sm', 'relative min-h-9 min-w-9')}
        >
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          {commentSummary.total > 0 && (
            <span
              className={`absolute -right-1 -top-1 min-w-4 px-1 text-xs ${commentSummary.unresolved > 0 ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
              aria-hidden="true"
            >
              {commentSummary.unresolved}
            </span>
          )}
        </button>
      </Tooltip>
      <CopyRecordLink workspaceId={workspaceId} sentenceId={record.id} compact />
    </div>
  )
  return (
    <ResizablePanel
      defaultWidth={50}
      minWidth={30}
      maxWidth={70}
      side="left"
      storageKey="labeling-left-panel-width"
      className="bg-white border-r border-gray-200 relative flex flex-col"
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
        {discussion}
        <div className="p-6">
          {fields.length === 0 && <div className="flex justify-end mb-4">{actions}</div>}
          <div className="space-y-6">
            {/* Field Columns */}
            {fields.map(([num, name], index) => {
              const value = record[`field${num}` as keyof LabelingRecord] as string | null
              if (!value) return null

              return (
                <div key={num}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h2 className="min-w-0 break-words text-sm font-medium text-indigo-700">{formatFieldName(name)}</h2>
                    {index === 0 && actions}
                  </div>
                  <p className="text-gray-900 whitespace-pre-wrap leading-relaxed text-lg">{value}</p>
                </div>
              )
            })}

            {/* Support Columns */}
            {record.supportMapping && Object.keys(record.supportMapping).length > 0 && (
              <div className="pt-6 border-t border-gray-200">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Support information</h2>
                <div className="space-y-4">
                  {Object.entries(record.supportMapping).map(([num, name]) => {
                    const value = record[`support${num}` as keyof LabelingRecord] as string | null
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
      </div>

      {/* Navigation Buttons - Bottom Right */}
      <div className="p-4 flex items-center justify-between gap-2 bg-white">
        <div className="flex items-center gap-3 text-xs font-medium text-gray-600">
          {sentenceIds.length > 0 && currentIndex >= 0 ? (
            <>
              <span>
                Sentence {currentIndex + 1} of {sentenceIds.length}
              </span>
              <div
                className="w-32 h-1.5 bg-gray-200"
                role="progressbar"
                aria-label="Position in the list"
                aria-valuemin={1}
                aria-valuemax={sentenceIds.length}
                aria-valuenow={currentIndex + 1}
              >
                <div
                  className="h-full bg-indigo-600 transition-all"
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
            disabled={disabled || currentIndex <= 0}
            onClick={onPrevious}
            className="p-2 text-gray-600 hover:text-[#008080] hover:bg-[#e6fbf8] rounded-lg transition-colors"
            title="Previous sentence"
            aria-label="Previous sentence"
          >
            <ChevronLeft className="w-5 h-5" aria-hidden="true" />
          </button>
          <button
            disabled={disabled}
            onClick={onNext}
            className="p-2 text-gray-600 hover:text-[#008080] hover:bg-[#e6fbf8] rounded-lg transition-colors"
            title="Next sentence"
            aria-label="Next sentence"
          >
            <ChevronRight className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </ResizablePanel>
  )
}
