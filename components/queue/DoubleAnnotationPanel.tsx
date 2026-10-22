'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Combobox from '@/components/ui/Combobox'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { fetchJson, HttpError } from '@/lib/query/fetch'
import { buttonClass } from '@/components/ui/styles'

type Person = { id: string; name: string | null; email: string; role: string }
type Counts = { fresh: number; labelled: number; already: number; needs_first: number }

/**
 * "Two independent labels" in the assignment dialog: choose two people, see
 * what will happen per record, then start (POST /sentences/double-annotation;
 * the preview's counts are sent back so a changed selection is refused).
 * Already labelled records only need one more person.
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
  const [firstUserId, setFirstUserId] = useState<string | null>(null)
  const [secondUserId, setSecondUserId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const body = { sentenceIds, firstUserId, secondUserId }
  const preview = useQuery({
    queryKey: ['ws', workspaceId, 'double-annotation-preview', sentenceIds.join(','), firstUserId, secondUserId],
    queryFn: ({ signal }) =>
      fetchJson<{ counts: Counts }>(api('/sentences/double-annotation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, dryRun: true }),
        signal
      }).then(d => d.counts),
    enabled: secondUserId !== null && firstUserId !== secondUserId,
    staleTime: 0,
    gcTime: 0
  })
  const counts = preview.data
  const startable = counts ? counts.fresh + counts.labelled : 0

  const options = users.map(u => ({ value: u.id, label: u.name || u.email, hint: u.role }))
  const nameOf = (id: string | null) => users.find(u => u.id === id)?.name ?? 'the second person'

  const start = async () => {
    if (!counts || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const data = await fetchJson<{ started: number }>(api('/sentences/double-annotation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, expect: counts })
      })
      onDone(data.started)
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Combobox
          label="First person"
          options={options.filter(o => o.value !== secondUserId)}
          value={firstUserId}
          onChange={value => setFirstUserId(value)}
          placeholder="Choose a person"
          disabled={submitting}
        />
        <Combobox
          label="Second person"
          options={options.filter(o => o.value !== firstUserId)}
          value={secondUserId}
          onChange={value => setSecondUserId(value)}
          placeholder="Choose a person"
          disabled={submitting}
        />
      </div>
      <p className="text-xs text-gray-600">
        Already labelled records keep their labels as the first answer, so only the second person is needed for them.
      </p>

      <div aria-live="polite" className="text-sm">
        {secondUserId === null ? null : preview.isPending ? (
          <span className="text-gray-600">Checking the selected records…</span>
        ) : preview.isError ? (
          <span role="alert" className="text-red-700">
            {preview.error instanceof Error ? preview.error.message : 'Could not check the records'}
          </span>
        ) : counts ? (
          <ul className="space-y-1 text-gray-800">
            {counts.fresh > 0 && <li>{counts.fresh} not yet labelled: both people label them</li>}
            {counts.labelled > 0 && (
              <li>
                {counts.labelled} already labelled: their labels count as the first answer; {nameOf(secondUserId)} (or
                the other person, if {nameOf(secondUserId)} labelled one) adds the second
              </li>
            )}
            {counts.already > 0 && <li>{counts.already} already in double annotation: left unchanged</li>}
            {counts.needs_first > 0 && (
              <li className="text-red-700">
                {counts.needs_first} need two people: choose a first person, or they are left out
              </li>
            )}
          </ul>
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
