import type { ProgressOverview } from '@/lib/contracts/progress'
import { formatNumber, percent } from './format'

function Card({ label, value, detail, testId }: { label: string; value: string; detail?: string; testId: string }) {
  return (
    // The brand stat figure: a rule on top, a large number, a grey label; no box.
    <div className="border-t border-gray-900 pt-3" data-testid={testId}>
      <dt className="text-sm text-gray-600">{label}</dt>
      <dd className="mt-1">
        <span className="block text-4xl font-semibold tabular-nums tracking-tight text-gray-900">{value}</span>
        {detail && <span className="mt-1 block text-sm text-gray-600">{detail}</span>}
      </dd>
    </div>
  )
}

/** Workload now (three cards) and records labeled in the period (one). */
export default function WorkloadCards({ overview }: { overview: ProgressOverview }) {
  const { workload, activity } = overview
  const share = percent(workload.complete, workload.total)
  const breakdown = [
    `${formatNumber(workload.pending)} pending`,
    workload.skipped ? `${formatNumber(workload.skipped)} skipped` : null,
    workload.escalated ? `${formatNumber(workload.escalated)} escalated` : null
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
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
    </dl>
  )
}
