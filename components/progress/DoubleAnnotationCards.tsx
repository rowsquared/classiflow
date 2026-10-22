import type { DoubleProgress } from '@/lib/contracts/progress'
import { formatNumber, percent } from './format'

/**
 * Double annotation in the report's scope (supervisors and admins). The
 * figures overlap: a record that needs review is also in progress.
 * Agreement is the original comparison (before any review), per taxonomy,
 * with its denominator.
 */
export default function DoubleAnnotationCards({ double }: { double: DoubleProgress }) {
  const figures = [
    { label: 'In progress', value: double.inProgress, detail: 'Records waiting for labels or review' },
    { label: 'Needs review', value: double.needsReview, detail: 'The two labels differ' },
    { label: 'Needs another person', value: double.needsPerson, detail: 'A part was skipped or lost its person' },
    { label: 'Confirmed', value: double.confirmed, detail: 'Agreed, reviewed or single label accepted' },
    { label: 'Reviewed in period', value: double.reviewedInPeriod, detail: 'Records with a review decision' }
  ]
  return (
    <div className="space-y-6" data-testid="double-annotation">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-5">
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
      <table className="w-full max-w-xl text-sm">
        <caption className="text-left text-sm font-medium text-gray-900 mb-2">
          Agreement in the period (first two labels, before review)
        </caption>
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-700">
            <th scope="col" className="py-2 pr-4 font-medium">
              Taxonomy
            </th>
            <th scope="col" className="py-2 pr-4 font-medium text-right">
              Agreement
            </th>
            <th scope="col" className="py-2 font-medium text-right">
              Agreed / compared
            </th>
          </tr>
        </thead>
        <tbody>
          {double.agreement.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-2 text-gray-600">
                No records were compared in this period.
              </td>
            </tr>
          ) : (
            double.agreement.map(a => {
              const share = percent(a.agreed, a.compared)
              return (
                <tr key={a.taxonomyKey} className="border-b border-gray-100">
                  <td className="py-2 pr-4 text-gray-900">{a.taxonomyKey}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{share === null ? '–' : `${share}%`}</td>
                  <td className="py-2 text-right tabular-nums text-gray-700">
                    {formatNumber(a.agreed)} / {formatNumber(a.compared)}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
