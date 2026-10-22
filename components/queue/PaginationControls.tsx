'use client'
import { useState } from 'react'
import { buttonClass } from '@/components/ui/styles'

interface PaginationControlsProps {
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

const STANDARD_SIZES = [20, 50, 100, 250, 500, 9999]

export default function PaginationControls({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange
}: PaginationControlsProps) {
  const [customSize, setCustomSize] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)

  const startItem = total > 0 ? (page - 1) * pageSize + 1 : 0
  const endItem = Math.min(page * pageSize, total)

  // Check if current pageSize is a custom value
  const isCustomSize = !STANDARD_SIZES.includes(pageSize)

  const handleCustomSubmit = () => {
    const size = parseInt(customSize, 10)
    if (size > 0 && size <= 10000) {
      onPageSizeChange(size)
      setShowCustomInput(false)
      setCustomSize('')
    }
  }

  const handleSelectChange = (value: string) => {
    if (value === 'custom') {
      setShowCustomInput(true)
    } else {
      onPageSizeChange(Number(value))
    }
  }

  return (
    <div className="px-6 py-4 bg-white border-t border-gray-200 flex items-center justify-between">
      {/* Left: Page size selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">Show:</span>
        {showCustomInput ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="10000"
              value={customSize}
              onChange={e => setCustomSize(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCustomSubmit()}
              placeholder="Enter size"
              className="w-24 px-2 py-1.5 text-sm border border-gray-500 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              autoFocus
            />
            <button onClick={handleCustomSubmit} className={buttonClass('primary', 'sm')}>
              OK
            </button>
            <button
              onClick={() => {
                setShowCustomInput(false)
                setCustomSize('')
              }}
              className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        ) : (
          <select
            aria-label="Records per page"
            value={pageSize}
            onChange={e => handleSelectChange(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-500 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 bg-white"
          >
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
            <option value={9999}>All</option>
            {isCustomSize && <option value={pageSize}>{pageSize} (custom)</option>}
            <option value="custom">Custom...</option>
          </select>
        )}
      </div>

      {/* Center: Range display */}
      <div className="text-sm text-gray-600">
        {total > 0 ? (
          <>
            Showing {startItem.toLocaleString()} to {endItem.toLocaleString()} of {total.toLocaleString()}
          </>
        ) : (
          <>No sentences</>
        )}
      </div>

      {/* Right: Page navigation */}
      <div className="flex items-center gap-2">
        <button onClick={() => onPageChange(1)} disabled={page === 1} className={buttonClass('secondary', 'sm')}>
          « First
        </button>
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className={buttonClass('secondary')}
        >
          ← Previous
        </button>
        <span className="px-4 py-2 text-sm text-gray-900">
          Page {page} of {totalPages || 1}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages || totalPages === 0}
          className={buttonClass('secondary')}
        >
          Next →
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages || totalPages === 0}
          className={buttonClass('secondary', 'sm')}
        >
          Last »
        </button>
      </div>
    </div>
  )
}
