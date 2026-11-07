'use client'

import { DOUBLE_FILTERS, type DOUBLE_FILTER_LABELS } from '@/lib/queue-url'

type DoubleFilter = keyof typeof DOUBLE_FILTER_LABELS
export type DoubleCounts = Record<DoubleFilter, number>

const CHIPS: Record<DoubleFilter, { label: string; tone: string }> = {
  any: { label: 'All double', tone: 'bg-gray-100 text-gray-800 border-gray-300' },
  waiting: { label: 'Waiting', tone: 'bg-[#e0ecff] text-[#1e3a8a] border-[#b9cdf3]' },
  review: { label: 'Needs review', tone: 'bg-[#F7F3B3] text-[#4d470b] border-[#d6cf6b]' },
  gap: { label: 'Needs another person', tone: 'bg-red-50 text-red-800 border-red-200' },
  done: { label: 'Confirmed', tone: 'bg-indigo-50 text-indigo-800 border-indigo-200' }
}

/**
 * Managers' double annotation views of the queue, with their counts under
 * the other filters (stats `double`). One chip is active at a time; pressing
 * it again leaves the double annotation view.
 */
export default function DoubleFilterChips({
  counts,
  active,
  onChange,
  disagreement,
  onClearDisagreement
}: {
  counts: DoubleCounts
  active: DoubleFilter | null
  onChange: (value: DoubleFilter | null) => void
  /** `[taxonomyKey, level, codeA, codeB]`: the queue shows the records of one disagreement. */
  disagreement?: string[] | null
  onClearDisagreement?: () => void
}) {
  return (
    <div
      role="group"
      aria-label="Double annotation"
      className="flex flex-wrap items-center gap-2 px-6 py-2 border-b border-gray-200"
    >
      <span className="text-sm text-gray-700">Double annotation</span>
      {DOUBLE_FILTERS.map(value => {
        const pressed = active === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(pressed ? null : value)}
            className={`px-2 py-0.5 text-sm border focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              pressed ? 'bg-indigo-600 border-indigo-600 text-white' : CHIPS[value].tone
            }`}
          >
            {CHIPS[value].label} · {counts[value].toLocaleString()}
          </button>
        )
      })}
      {disagreement?.length === 4 && (
        <span className="inline-flex items-center gap-2 px-2 py-0.5 text-sm border border-gray-400 text-gray-900">
          <span>
            {disagreement[0]} level {disagreement[1]}: <span className="font-mono">{disagreement[2]}</span> ↔{' '}
            <span className="font-mono">{disagreement[3]}</span>
          </span>
          {onClearDisagreement && (
            <button
              type="button"
              onClick={onClearDisagreement}
              aria-label="Clear disagreement filter"
              className="text-gray-700 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              ✕
            </button>
          )}
        </span>
      )}
    </div>
  )
}
