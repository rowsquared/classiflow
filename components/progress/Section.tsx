import type { ReactNode } from 'react'

type SectionProps = {
  id: string
  title: string
  /** One line under the title saying what the numbers cover. */
  description?: ReactNode
  /** Controls on the right of the title (granularity, view toggle). */
  actions?: ReactNode
  /** No data for this view yet: a skeleton of `skeletonHeight` instead of the children. */
  loading: boolean
  /** Showing the previous results of the same scope while new ones load. */
  updating: boolean
  /** The latest request failed; shown with a Retry button. */
  error: string | null
  onRetry: () => void
  skeletonHeight?: string
  children?: ReactNode
}

/**
 * One independently loading part of the dashboard: it shows its own
 * skeleton, "Updating" state and error with Retry, so a slow or failed
 * report never blocks or blanks the others.
 */
export default function Section({
  id,
  title,
  description,
  actions,
  loading,
  updating,
  error,
  onRetry,
  skeletonHeight = 'h-32',
  children
}: SectionProps) {
  const headingId = `${id}-heading`
  return (
    <section aria-labelledby={headingId} aria-busy={loading || updating} className="mb-8" data-section={id}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 id={headingId} className="text-lg font-semibold text-gray-900">
            {title}
          </h2>
          {description && <p className="text-sm text-gray-600 mt-0.5">{description}</p>}
        </div>
        <div className="flex items-center gap-3">
          {updating && !error && (
            <span className="text-xs text-gray-600" role="status">
              Updating…
            </span>
          )}
          {actions}
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-red-300 bg-white px-3 py-1 font-medium text-red-800 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            Retry
          </button>
        </div>
      )}
      {loading && !error ? (
        <div className={`${skeletonHeight} animate-pulse rounded-lg bg-gray-100`} aria-hidden="true" />
      ) : (
        !error && <div className={updating ? 'opacity-60 transition-opacity' : undefined}>{children}</div>
      )}
    </section>
  )
}
