'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Combobox from '@/components/ui/Combobox'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { fetchJson, HttpError } from '@/lib/query/fetch'
import { buttonClass } from '@/components/ui/styles'

type Person = { id: string; name: string | null; email: string; role: string }
type Counts = { fresh: number; labelled: number; already: number; needs_first: number }
type Preview = {
  counts: Counts
  sampled: number
  mixed: number
  people: Array<{ userId: string; name: string; parts: number }>
  losingAccess: number
}

/** The second person's "automatic" choice (POST /sentences/double-annotation `secondUserId: 'auto'`). */
const AUTO = 'auto'

/**
 * "Two independent labels" in the assignment dialog: choose who labels
 * (a second person, or automatically balanced across the team), optionally
 * a random share of the selection, see what happens per record and per
 * person, then start (POST /sentences/double-annotation; the preview's counts
 * are sent back so a changed selection is refused).
 */
export default function DoubleAnnotationPanel({
  sentenceIds,
  users,
  onCancel,
  onDone
}: {
  sentenceIds: string[]
  users: Person[]
  onCancel: () => void
  onDone: (started: number) => void
}) {
  const { workspaceId, api } = useWorkspacePaths()
  const [mode, setMode] = useState<'second' | 'both'>('second')
  const [firstUserId, setFirstUserId] = useState<string | null>(null)
  const [secondUserId, setSecondUserId] = useState<string | null>(AUTO)
  const [sampling, setSampling] = useState(false)
  const [percent, setPercent] = useState(10)
  // One random draw per dialog: the preview and the start pick the same records.
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000_000))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const first = mode === 'both' ? firstUserId : null
  const body = {
    sentenceIds,
    firstUserId: first,
    secondUserId,
    ...(sampling ? { sample: percent, seed } : {})
  }
  const ready = secondUserId !== null && first !== secondUserId && (mode === 'second' || first !== null)
  const preview = useQuery({
    queryKey: [
      'ws',
      workspaceId,
      'double-annotation-preview',
      sentenceIds.join(','),
      first,
      secondUserId,
      sampling,
      percent,
      seed
    ],
    queryFn: ({ signal }) =>
      fetchJson<Preview>(api('/sentences/double-annotation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, dryRun: true }),
        signal
      }),
    enabled: ready && (!sampling || (percent >= 1 && percent <= 100)),
    staleTime: 0,
    gcTime: 0
  })
  const data = preview.data
  const counts = data?.counts
  const startable = counts ? counts.fresh + counts.labelled : 0

  const people = users.map(u => ({ value: u.id, label: u.name || u.email, hint: u.role }))
  const secondOptions = [
    { value: AUTO, label: 'Automatic: balanced across my team', hint: 'fewest open parts first' },
    ...people.filter(o => o.value !== first)
  ]

  const start = async () => {
    if (!counts || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await fetchJson<{ started: number }>(api('/sentences/double-annotation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, expect: counts })
      })
      onDone(result.started)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start double annotation')
      if (e instanceof HttpError && e.status === 409) void preview.refetch()
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-700">
        Two people label each record without seeing each other&apos;s answer. Matching answers are confirmed
        automatically; differences come to you for review. Until then the first answer is used in exports.
      </p>

      <fieldset className="grid gap-2 sm:grid-cols-2" disabled={submitting}>
        <legend className="sr-only">Who labels</legend>
        {(
          [
            [
              'second',
              'Add a second label',
              'Labelled records keep their labels as the first answer; one more person labels.'
            ],
            ['both', 'Both label from scratch', 'Two people label each record. Needed for records nobody labelled yet.']
          ] as const
        ).map(([value, title, detail]) => (
          <label
            key={value}
            className={`flex items-start gap-2 p-3 border text-sm cursor-pointer ${
              mode === value ? 'border-indigo-600 bg-indigo-50' : 'border-gray-500'
            }`}
          >
            <input
              type="radio"
              name="double-start-mode"
              checked={mode === value}
              onChange={() => setMode(value)}
              className="mt-0.5"
            />
            <span>
              <span className="text-gray-900">{title}</span>
              <span className="block text-gray-600">{detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        {mode === 'both' && (
          <Combobox
            label="First person"
            options={people.filter(o => o.value !== secondUserId)}
            value={firstUserId}
            onChange={value => setFirstUserId(value)}
            placeholder="Choose a person"
            disabled={submitting}
          />
        )}
        <Combobox
          label={mode === 'both' ? 'Second person' : 'Person who adds the label'}
          options={secondOptions}
          value={secondUserId}
          onChange={value => setSecondUserId(value)}
          placeholder="Choose a person"
          disabled={submitting}
        />
      </div>
      <p className="text-xs text-gray-600 -mt-2">
        Nobody labels a record twice: the author of existing labels never becomes its second person.
      </p>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-gray-900">
          <input
            type="checkbox"
            checked={sampling}
            onChange={e => setSampling(e.target.checked)}
            disabled={submitting}
          />
          Only a random share of the {sentenceIds.length.toLocaleString()} selected records
        </label>
        {sampling && (
          <label className="flex items-center gap-2 text-gray-700">
            <input
              type="number"
              min={1}
              max={100}
              value={percent}
              onChange={e => setPercent(Number(e.target.value))}
              disabled={submitting}
              aria-label="Share of the selection in percent"
              className="w-20 px-2 py-1 border border-gray-500 text-sm"
            />
            %
          </label>
        )}
      </div>

      <div aria-live="polite" className="text-sm">
        {!ready ? null : preview.isPending ? (
          <span className="text-gray-600">Checking the selected records…</span>
        ) : preview.isError ? (
          <span role="alert" className="text-red-700">
            {preview.error instanceof Error ? preview.error.message : 'Could not check the records'}
          </span>
        ) : data && counts ? (
          <div className="space-y-2">
            {sampling && <p className="text-gray-700">{data.sampled.toLocaleString()} records drawn at random</p>}
            <ul className="space-y-1 text-gray-800">
              {counts.labelled > 0 && (
                <li>{counts.labelled} already labelled: their labels count as the first answer</li>
              )}
              {counts.fresh > 0 && (
                <li>
                  {counts.fresh} labelled by both people
                  {data.mixed > 0 ? ` (${data.mixed} of them have partial labels or labels by several people)` : ''}
                </li>
              )}
              {counts.already > 0 && <li>{counts.already} already in double annotation: left unchanged</li>}
              {counts.needs_first > 0 && (
                <li className="text-red-700">
                  {counts.needs_first} cannot start: choose “Both label from scratch” with two people, or another second
                  person
                </li>
              )}
              {data.losingAccess > 0 && (
                <li className="text-gray-700">
                  {data.losingAccess} other labeller {data.losingAccess === 1 ? 'assignment ends' : 'assignments end'}{' '}
                  (only the two people keep these records)
                </li>
              )}
            </ul>
            {data.people.length > 0 && (
              <table className="w-full text-sm">
                <caption className="text-left text-gray-700 mb-1">New parts per person</caption>
                <tbody>
                  {data.people.map(p => (
                    <tr key={p.userId} className="border-t border-gray-100">
                      <td className="py-1 pr-4 text-gray-900">{p.name}</td>
                      <td className="py-1 text-right tabular-nums">+{p.parts.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </div>

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3 pt-4 border-t border-gray-200">
        <button
          type="button"
          disabled={submitting}
          onClick={onCancel}
          className={buttonClass('secondary', 'md', 'flex-1')}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={start}
          disabled={submitting || !counts || startable === 0}
          className={buttonClass('primary', 'md', 'flex-1')}
        >
          {submitting ? 'Starting…' : `Start double annotation${startable ? ` for ${startable}` : ''}`}
        </button>
      </div>
    </div>
  )
}
