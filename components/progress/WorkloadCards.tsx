import type { ReactNode } from 'react'
import type { ProgressOverview } from '@/lib/contracts/progress'
import { formatDay, formatNumber, percent } from './format'

function Card({
  label,
  value,
  detail,
  tone = 'border-gray-200 bg-gray-50 text-gray-900',
  testId,
  compact = false
}: {
  label: string
  value: string
  detail?: ReactNode
  tone?: string
  testId: string
  compact?: boolean
}) {
  return (
    <div className={`min-w-0 border p-3 sm:p-4 ${tone}`} data-testid={testId}>
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="mt-1">
        <span
          className={`block font-semibold tabular-nums tracking-tight ${compact ? 'text-xl leading-tight' : 'text-3xl'}`}
        >
          {value}
        </span>
        {detail && <div className="mt-1 text-xs text-gray-700">{detail}</div>}
      </dd>
    </div>
  )
}

/** Current workload, period activity, and a straight-line completion estimate. */
export default function WorkloadCards({ overview }: { overview: ProgressOverview }) {
  const { workload, activity, projection } = overview
  const share = percent(workload.complete, workload.total)
  const breakdown = [
    `${formatNumber(workload.pending)} pending`,
    workload.skipped ? `${formatNumber(workload.skipped)} skipped` : null,
    workload.escalated ? `${formatNumber(workload.escalated)} escalated` : null
  ]
    .filter(Boolean)
    .join(', ')
  const projectionValue =
    projection.status === 'complete'
      ? 'Complete'
      : projection.status === 'projected'
        ? formatDay(projection.date!)
        : projection.status === 'too-distant'
          ? 'More than 10 years'
          : 'Not enough activity'
  const rate = (value: number) => value.toLocaleString('en-GB', { maximumFractionDigits: 1 })
  const projectionDetail =
    projection.status === 'complete'
      ? 'No records remaining'
      : `${rate(projection.completedPerDay)} complete records labeled/day over ${projection.daysInPeriod} days`

  return (
    <>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <Card label="Total records now" value={formatNumber(workload.total)} testId="card-total" />
        <Card
          label="Complete now"
          value={formatNumber(workload.complete)}
          tone="border-indigo-100 bg-indigo-50 text-indigo-900"
          detail={
            share === null ? (
              'No records in this scope'
            ) : (
              <>
                <span>{share}% of the total</span>
                <div className="mt-2 h-1.5 bg-indigo-100" aria-hidden="true">
                  <div className="h-full bg-indigo-600" style={{ width: `${share}%` }} />
                </div>
              </>
            )
          }
          testId="card-complete"
        />
        <Card
          label="Remaining now"
          value={formatNumber(workload.remaining)}
          detail={breakdown}
          testId="card-remaining"
        />
        <Card label="Labeled in period" value={formatNumber(activity.labeledRecords)} testId="card-labeled" />
        <Card
          label="Projected completion"
          value={projectionValue}
          detail={projectionDetail}
          testId="card-projection"
          compact
        />
      </dl>
      <details className="mt-3 text-sm text-gray-600">
        <summary className="w-fit cursor-pointer text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-600">
          How we estimate completion
        </summary>
        <p className="mt-1 max-w-2xl">
          The estimate uses the selected period’s pace of human labeling to project when the remaining work will finish.
          New imports and relabeling can change the estimate.
        </p>
      </details>
    </>
  )
}
