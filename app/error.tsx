'use client'

import { buttonClass } from '@/components/ui/styles'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-4">Something went wrong</h2>
        <p className="text-gray-600 mb-4">{error.message}</p>
        <button onClick={reset} className={buttonClass('primary')}>
          Try again
        </button>
      </div>
    </div>
  )
}
