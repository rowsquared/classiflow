import Link from 'next/link'
import type { DoubleProgress } from '@/lib/contracts/progress'
import { serializeQueueUrlState } from '@/lib/queue-url'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { formatNumber, percent } from './format'

const share = (part: number, whole: number) => {
  const value = percent(part, whole)
  return value === null ? '–' : `${value}%`
}

const th = 'py-2 pr-4 font-medium'
const thNum = `${th} text-right`
const td = 'py-2 pr-4'
const tdNum = `${td} text-right tabular-nums`

/**
 * Double annotation in the report's scope (supervisors and admins). The
 * figures overlap: a record that needs review is also in progress.
 * Agreement is the original comparison (before any review): per taxonomy and
 * level (the two answers agree on levels 1..n, or are the same path), per
 * labeller, and the code pairs that disagree most.
 */
export default function DoubleAnnotationCards({ double }: { double: DoubleProgress }) {
  const { href } = useWorkspacePaths()
  // The queue lists the records of a disagreement over all periods.
  const recordsHref = (c: DoubleProgress['confusions'][number]) =>
    href(`/queue${serializeQueueUrlState({ tab: 'all', disagreement: [c.taxonomyKey, String(c.level), c.a, c.b] })}`)
  const figures = [
    { label: 'In progress', value: double.inProgress, detail: 'Records waiting for labels or review' },
    { label: 'Needs review', value: double.needsReview, detail: 'The two labels differ' },
    { label: 'Needs another person', value: double.needsPerson, detail: 'A part was skipped or lost its person' },
    {
      label: 'Open over 7 days',
      value: double.waiting.over7,
      detail: `Parts still to do (${formatNumber(double.waiting.over14)} over 14 days)`
    },
    { label: 'Confirmed', value: double.confirmed, detail: 'Agreed, reviewed or single label accepted' },
    { label: 'Reviewed in period', value: double.reviewedInPeriod, detail: 'Records with a review decision' }
  ]
  const levels = Math.max(1, ...double.agreementByLevel.map(t => t.agreed.length))
  return (
    <div className="space-y-8" data-testid="double-annotation">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-6">
        {figures.map(f => (
          <div key={f.label} className="min-w-0 border-t border-gray-900 pt-3">
            <dt className="text-sm text-gray-600">{f.label}</dt>
            <dd className="mt-1">
              <span className="block text-2xl font-semibold tabular-nums tracking-tight text-gray-900">
                {formatNumber(f.value)}
              </span>
              <span className="mt-1 block text-sm text-gray-600">{f.detail}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full max-w-3xl text-sm">
          <caption className="text-left text-sm font-medium text-gray-900 mb-2">
            Agreement in the period (first two labels, before review)
          </caption>
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-700">
              <th scope="col" className={th}>
                Taxonomy
              </th>
              {Array.from({ length: levels }, (_, i) => (
                <th key={i} scope="col" className={thNum}>
                  Level {i + 1}
                </th>
              ))}
              <th scope="col" className={thNum}>
                Full path
              </th>
              <th scope="col" className={thNum}>
                Compared
              </th>
            </tr>
          </thead>
          <tbody>
            {double.agreement.length === 0 ? (
              <tr>
                <td colSpan={levels + 3} className="py-2 text-gray-600">
                  No records were compared in this period.
                </td>
              </tr>
            ) : (
              double.agreement.map(a => {
                const byLevel = double.agreementByLevel.find(t => t.taxonomyKey === a.taxonomyKey)
                return (
                  <tr key={a.taxonomyKey} className="border-b border-gray-100">
                    <td className={`${td} text-gray-900`}>{a.taxonomyKey}</td>
                    {Array.from({ length: levels }, (_, i) => {
                      const agreed = byLevel?.agreed[i]
                      return (
                        <td key={i} className={tdNum} title={byLevel?.levelNames[i] ?? undefined}>
                          {agreed === undefined ? '' : share(agreed, a.compared)}
                        </td>
                      )
                    })}
                    <td className={tdNum}>{share(a.agreed, a.compared)}</td>
                    <td className={`${tdNum} text-gray-700`}>
                      {formatNumber(a.agreed)} / {formatNumber(a.compared)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {double.labellers.length > 0 && (
        <div className="grid gap-8 lg:grid-cols-2">
          <table className="w-full text-sm">
            <caption className="text-left text-sm font-medium text-gray-900 mb-2">By labeller</caption>
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-700">
                <th scope="col" className={th}>
                  Labeller
                </th>
                <th scope="col" className={thNum}>
                  Compared
                </th>
                <th scope="col" className={thNum}>
                  Agreed
                </th>
                <th scope="col" className={thNum}>
                  Reviewer chose theirs
                </th>
              </tr>
            </thead>
            <tbody>
              {double.labellers.map(l => (
                <tr key={l.name} className="border-b border-gray-100">
                  <td className={`${td} text-gray-900`}>{l.name}</td>
                  <td className={tdNum}>{formatNumber(l.compared)}</td>
                  <td className={tdNum}>{share(l.agreed, l.compared)}</td>
                  <td className={tdNum}>
                    {l.decided > 0 ? `${formatNumber(l.chosen)} of ${formatNumber(l.decided)}` : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="w-full text-sm">
            <caption className="text-left text-sm font-medium text-gray-900 mb-2">Most frequent disagreements</caption>
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-700">
                <th scope="col" className={th}>
                  Codes
                </th>
                <th scope="col" className={thNum}>
                  Level
                </th>
                <th scope="col" className={thNum}>
                  Pairs
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">Records</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {double.confusions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-2 text-gray-600">
                    No disagreements in this period.
                  </td>
                </tr>
              ) : (
                double.confusions.map(c => (
                  <tr key={`${c.taxonomyKey}-${c.level}-${c.a}-${c.b}`} className="border-b border-gray-100">
                    <td className={`${td} text-gray-900`}>
                      <span className="text-gray-600">{c.taxonomyKey}</span> <span className="font-mono">{c.a}</span>{' '}
                      {c.aLabel ?? ''} ↔ <span className="font-mono">{c.b}</span> {c.bLabel ?? ''}
                    </td>
                    <td className={tdNum}>{c.level}</td>
                    <td className={tdNum}>{formatNumber(c.count)}</td>
                    <td className={td}>
                      <Link
                        href={recordsHref(c)}
                        className="text-indigo-700 underline hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        title="All records with this disagreement, from every period"
                      >
                        Show records<span className="sr-only">{` for ${c.taxonomyKey} ${c.a} and ${c.b}`}</span>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
