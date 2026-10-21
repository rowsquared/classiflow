'use client'

import type { ReactNode } from 'react'

/**
 * A CSV file input styled as a field with the chosen file's name and a
 * "Choose file..." button; `children` render after it (e.g. Validate).
 */
export default function FileChooser({
  id,
  file,
  onChange,
  children
}: {
  id: string
  file: File | null
  onChange: (file: File | null) => void
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 relative">
        <input
          type="file"
          accept=".csv"
          onChange={e => onChange(e.target.files?.[0] ?? null)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          id={id}
          aria-label="CSV file"
        />
        <div className="flex items-center gap-3 px-4 py-2.5 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors">
          <span className="text-sm text-gray-600 truncate flex-1">{file ? file.name : 'No file chosen'}</span>
        </div>
      </div>
      <label
        htmlFor={id}
        className="px-6 py-2.5 bg-indigo-50 text-indigo-700 font-medium rounded-lg hover:bg-indigo-100 transition-colors cursor-pointer whitespace-nowrap border border-indigo-200"
      >
        Choose file...
      </label>
      {children}
    </div>
  )
}
