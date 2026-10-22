'use client'

import { Filter as FilterIcon } from 'lucide-react'

interface QueueToolbarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  stats: {
    total: number
    submitted: number
    pending: number
    progress: number
  }
  /** The last statistics refresh failed: the numbers shown are older. */
  statsStale?: boolean
  onToggleFilters: () => void
  activeFilterCount: number
}

export default function QueueToolbar({
  searchQuery,
  onSearchChange,
  stats,
  statsStale = false,
  onToggleFilters,
  activeFilterCount
}: QueueToolbarProps) {
  return (
    <div className="bg-white border-b border-gray-200 p-4">
      {/* Search and Progress Row */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleFilters}
            className="relative flex items-center justify-center w-10 h-10 border border-gray-400 rounded-lg text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            title="Toggle filters"
            aria-label="Toggle filters"
          >
            <FilterIcon className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 bg-indigo-600 text-white text-xs font-semibold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Search */}
          <div className="relative w-96 max-w-[50vw]">
            <input
              type="text"
              placeholder="Search sentences..."
              aria-label="Search records"
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              className="w-full px-4 py-2 pr-10 border border-gray-500 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-900 text-lg w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100"
                title="Clear search"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Progress Indicator */}
        <div className="text-sm text-gray-600">
          <span className="font-medium text-gray-900">{stats.submitted.toLocaleString()}</span> of{' '}
          <span className="font-medium text-gray-900">{stats.total.toLocaleString()}</span> labeled
          <span className="text-gray-500 ml-2">({stats.progress}%)</span>
          {statsStale && (
            <span className="ml-2 text-amber-700" role="status">
              · could not refresh, may be out of date
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
