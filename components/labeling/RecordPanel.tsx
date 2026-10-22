'use client'

import ResizablePanel from '@/components/ResizablePanel'
import { formatFieldName } from '@/lib/utils'
import type { NavigationList } from '@/lib/labeling-navigation'
import type { LabelingRecord } from './data'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type RecordPanelProps = {
  record: LabelingRecord
  navigation: NavigationList
  onPrevious: () => void
  onNext: () => void
}

/** Left side of the labelling screen: the record's fields and context, and previous/next. */
export default function RecordPanel({ record, navigation, onPrevious, onNext }: RecordPanelProps) {
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
      <div className="flex-1 overflow-y-auto p-6">
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
            onClick={onPrevious}
            className="p-2 text-gray-600 hover:text-[#008080] hover:bg-[#e6fbf8] rounded-lg transition-colors"
            title="Previous sentence"
            aria-label="Previous sentence"
          >
            <ChevronLeft className="w-5 h-5" aria-hidden="true" />
          </button>
          <button
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
