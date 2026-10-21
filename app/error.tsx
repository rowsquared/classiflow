'use client'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-4">Something went wrong!</h2>
        <p className="text-gray-600 mb-4">{error.message}</p>
        <button onClick={reset} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          Try again
        </button>
      </div>
    </div>
  )
}
