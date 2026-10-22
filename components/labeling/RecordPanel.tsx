'use client'

import type { ReactNode } from 'react'
import { MessageSquare } from 'lucide-react'
import { CopyRecordLink } from '@/components/CopyRecordLink'
import { buttonClass } from '@/components/ui/styles'
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
  return (
    <ResizablePanel
      defaultWidth={50}
      minWidth={30}
      maxWidth={70}
      side="left"
      storageKey="labeling-left-panel-width"
      className="bg-white border-r border-gray-200 relative flex flex-col"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={onComments}
          aria-expanded={commentsOpen}
          aria-controls={commentsOpen ? 'record-comments' : undefined}
          aria-keyshortcuts="C"
          title="Open comments (C)"
          className={buttonClass(commentSummary.unresolved > 0 ? 'accent' : 'secondary', 'sm')}
        >
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          Comments{commentSummary.total > 0 ? ` · ${commentSummary.unresolved}` : ''}
          <kbd className="text-xs border border-gray-300 px-1">C</kbd>
        </button>
        <CopyRecordLink workspaceId={workspaceId} sentenceId={record.id} />
        {commentSummary.total > commentSummary.unresolved && (
          <span className="text-xs text-gray-600">{commentSummary.total - commentSummary.unresolved} resolved</span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {discussion}
        <div className="p-6">
          <div className="space-y-6">
            {/* Field Columns */}
            {record.fieldMapping &&
              Object.entries(record.fieldMapping).map(([num, name]) => {
                const value = record[`field${num}` as keyof LabelingRecord] as string | null
                if (!value) return null

                return (
                  <div key={num}>
                    <h2 className="text-sm font-semibold text-indigo-700 mb-2">{formatFieldName(name)}</h2>
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
