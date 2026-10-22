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

/** A queue row's double annotation for managers: one short state in words, details in the tooltip. */
export default function DoubleBadge({ summary }: { summary: DoubleRowSummary }) {
  const { text, tone } = STATES[summary.state]
  const label = summary.state === 'waiting' ? `${summary.done}/2 ${text}` : text
  const title = summary.people.map(p => `${p.name}: ${PART_STATUS[p.status] ?? p.status}`).join(', ')
  return (
    <div className="mt-1 flex flex-wrap gap-1" title={title}>
      <span className={badgeClass(tone)}>
        <span className="sr-only">Double annotation: </span>
        {label}
      </span>
      {summary.gap && <span className={badgeClass('danger')}>Needs another person</span>}
    </div>
  )
}
