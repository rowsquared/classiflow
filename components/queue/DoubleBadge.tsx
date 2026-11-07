import { badgeClass, type BadgeTone } from '@/components/ui/styles'
import type { DoubleRowSummary } from '@/lib/double-annotation'

const STATES: Record<DoubleRowSummary['state'], { text: string; tone: BadgeTone }> = {
  waiting: { text: 'labelled', tone: 'info' },
  review: { text: 'Needs review', tone: 'warn' },
  agreed: { text: 'Agreed', tone: 'accent' },
  resolved: { text: 'Resolved', tone: 'accent' },
  accepted: { text: 'Single label accepted', tone: 'neutral' }
}

const PART_STATUS: Record<string, string> = { submitted: 'done', pending: 'to do', skipped: 'skipped' }

/**
 * A queue row's double annotation for managers (the Double column): one short
 * state in words, how long it has waited, what the disagreement is, and who
 * labels it (in the tooltip).
 */
export default function DoubleBadge({ summary }: { summary: DoubleRowSummary }) {
  const { text, tone } = STATES[summary.state]
  const label = summary.state === 'waiting' ? `${summary.done}/2 ${text}` : text
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
