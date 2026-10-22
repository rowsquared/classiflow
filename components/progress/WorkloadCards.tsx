import type { ProgressOverview } from '@/lib/contracts/progress'
import { formatDay, formatNumber, percent } from './format'

function Card({
  label,
  value,
  detail,
  testId,
  compact = false
}: {
  label: string
  value: string
  detail?: string
  testId: string
  compact?: boolean
}) {
  return (
    // The brand stat figure: a rule on top, a large number, a grey label; no box.
    <div className="min-w-0 border-t border-gray-900 pt-3" data-testid={testId}>
      <dt className="text-sm text-gray-600">{label}</dt>
      <dd className="mt-1">
        <span
          className={`block font-semibold tabular-nums tracking-tight text-gray-900 ${compact ? 'text-2xl leading-tight' : 'text-4xl'}`}
        >
          {value}
        </span>
        {detail && <span className="mt-1 block text-sm text-gray-600">{detail}</span>}
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
        : projection.status === 'no-net-progress'
          ? 'No date at current rate'
          : projection.status === 'too-distant'
            ? 'More than 10 years'
            : 'Not enough activity'
  const rate = (value: number) => value.toLocaleString('en-GB', { maximumFractionDigits: 1 })
  const projectionDetail =
    projection.status === 'complete'
      ? 'No records remaining'
      : `${rate(projection.completedPerDay)} complete records labeled/day − ${rate(projection.importedPerDay)} imported/day = ${rate(projection.netPerDay)} net/day`

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-5">
      <Card label="Total records now" value={formatNumber(workload.total)} testId="card-total" />
      <Card
        label="Complete now"
        value={formatNumber(workload.complete)}
        detail={share === null ? 'No records in this scope' : `${share}% of the total`}
        testId="card-complete"
      />
      <Card label="Remaining now" value={formatNumber(workload.remaining)} detail={breakdown} testId="card-remaining" />
      <Card
        label="Labeled in period"
        value={formatNumber(activity.labeledRecords)}
        detail="Distinct records with a saved human label"
        testId="card-labeled"
      />
      <Card
        label="Projected completion"
        value={projectionValue}
        detail={projectionDetail}
        testId="card-projection"
        compact
      />
    </dl>
  )
}
