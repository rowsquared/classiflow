'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ProgressTimeline } from '@/lib/contracts/progress'
import { formatDay, formatNumber, formatRange, formatShortDay } from './format'

/** A bucket's label: the day, or the part of the week inside the range. */
const bucketLabel = (b: ProgressTimeline['buckets'][number], granularity: 'day' | 'week') =>
  granularity === 'day' ? formatDay(b.start) : `Week of ${formatRange(b.start, b.end)}`

/**
 * Records labeled per day or week, as a bar chart or (for screen readers and
 * anyone who prefers numbers) as a table of the same buckets.
 */
export default function ActivityChart({ timeline, view }: { timeline: ProgressTimeline; view: 'chart' | 'table' }) {
  const { buckets, granularity } = timeline
  const total = buckets.reduce((sum, b) => sum + b.labeledRecords, 0)
  const busiest = buckets.reduce<(typeof buckets)[number] | null>(
    (best, b) => (b.labeledRecords > (best?.labeledRecords ?? 0) ? b : best),
    null
  )
  const unit = granularity === 'day' ? 'day' : 'week'
  const summary =
    total === 0
      ? `No records were labeled in this period.`
      : `${buckets.length} ${unit}s; busiest ${unit}: ${bucketLabel(busiest!, granularity)} with ${formatNumber(
          busiest!.labeledRecords
        )} records.`

  if (view === 'table') {
    return (
      <div className="max-h-96 overflow-auto border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <caption className="sr-only">Records labeled per {unit}</caption>
          <thead className="sticky top-0 bg-gray-50 text-left text-gray-700">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                {granularity === 'day' ? 'Day' : 'Week'}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Records labeled
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map(b => (
              <tr key={b.key} className="border-t border-gray-100">
                <th scope="row" className="px-4 py-1.5 text-left font-normal text-gray-800">
                  {bucketLabel(b, granularity)}
                </th>
                <td className="px-4 py-1.5 text-right tabular-nums">{formatNumber(b.labeledRecords)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const data = buckets.map(b => ({
    key: b.key,
    label: formatShortDay(b.start),
    full: bucketLabel(b, granularity),
    labeledRecords: b.labeledRecords
  }))

  return (
    <figure className="border border-gray-200 bg-white p-4" data-testid="activity-chart">
      <div role="img" aria-label={`Bar chart of records labeled per ${unit}. ${summary}`} className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: '#4b5563' }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#4b5563' }} width={48} />
            <Tooltip
              formatter={value => [formatNumber(Number(value)), 'Records labeled']}
              labelFormatter={(_, payload) => (payload?.[0]?.payload as { full?: string } | undefined)?.full ?? ''}
              cursor={{ fill: '#f5f5f5' }}
            />
            <Bar dataKey="labeledRecords" name="Records labeled" fill="var(--color-indigo-600)" radius={0} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-sm text-gray-600">
        {summary} The bars add up to {formatNumber(total)}: a record labeled in two {unit}s counts in both, so this can
        exceed “Labeled in period”.
      </figcaption>
    </figure>
  )
}
