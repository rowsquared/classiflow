import { badgeClass, type BadgeTone } from '@/components/ui/styles'
import { OUTCOME_LABELS, type DoubleRowSummary } from '@/lib/double-annotation'

const STATES: Record<DoubleRowSummary['state'], { text: string; tone: BadgeTone }> = {
  waiting: { text: OUTCOME_LABELS.waiting, tone: 'info' },
  review: { text: OUTCOME_LABELS.disagreed, tone: 'warn' },
  agreed: { text: OUTCOME_LABELS.agreed, tone: 'accent' },
  resolved: { text: OUTCOME_LABELS.reviewed, tone: 'accent' },
  accepted: { text: OUTCOME_LABELS.accepted_single, tone: 'neutral' }
}

const PART_STATUS: Record<string, string> = { submitted: 'done', pending: 'to do', skipped: 'skipped' }

/**
 * A queue row's double annotation for managers (the Double column): one short
 * state in words, how long it has waited, what the disagreement is, and who
 * labels it (in the tooltip).
 */
export default function DoubleBadge({ summary }: { summary: DoubleRowSummary }) {
  const { text, tone } = STATES[summary.state]
  const label = summary.state === 'waiting' ? `${text} · ${summary.done}/2 labeled` : text
  const title = summary.people.map(p => `${p.name}: ${PART_STATUS[p.status] ?? p.status}`).join(', ')
  return (
    <div className="flex flex-col gap-1" title={title}>
      <div className="flex flex-wrap gap-1">
        <span className={badgeClass(tone)}>
          <span className="sr-only">Double annotation: </span>
          {label}
        </span>
        {summary.gap && <span className={badgeClass('danger')}>Needs another person</span>}
      </div>
      {summary.waitingDays !== null && summary.waitingDays > 0 && (
        <span className="text-xs text-gray-600">
          open for {summary.waitingDays} {summary.waitingDays === 1 ? 'day' : 'days'}
        </span>
      )}
      {summary.disputes.map(d => (
        <span key={d.taxonomyKey} className="text-xs text-gray-700 whitespace-nowrap">
          {d.taxonomyKey} <span className="font-mono">A {d.a}</span> · <span className="font-mono">B {d.b}</span>
          <span className="sr-only">, differ from level {d.level}</span>
        </span>
      ))}
    </div>
  )
}
