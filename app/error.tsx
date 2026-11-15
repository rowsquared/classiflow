'use client'

import { buttonClass } from '@/components/ui/styles'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[calc(100dvh-66px)] items-center justify-center p-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-4">Something went wrong</h2>
        <p className="mb-4 text-gray-600">Try loading this page again.</p>
        {error.digest && <p className="mb-4 text-sm text-gray-600">Error reference {error.digest}</p>}
        <button onClick={reset} className={buttonClass('primary')}>
          Try again
        </button>
      </div>
    </div>
  )
}
