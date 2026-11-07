'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Modal from '@/components/Modal'
import Combobox from '@/components/ui/Combobox'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetch'

type Action = 'accept_single' | 'hand_over' | 'stop' | 'release'
type Result = { applied: number; skipped: Record<string, number> }
type Person = { id: string; name: string | null; email: string; role: string }

const ACTIONS: Record<Action, { title: string; detail: string; button: string }> = {
  accept_single: {
    title: 'Accept single label',
    detail: 'Records waiting for a second label keep the first one as the confirmed result.',
    button: 'Accept single label'
  },
  hand_over: {
    title: 'Hand over parts',
    detail: 'Every part one person has not started goes to another person (for example when someone leaves).',
    button: 'Hand over'
  },
  stop: {
    title: 'Stop double annotation',
    detail: 'Open parts end; the records become ordinary work with their current labels.',
    button: 'Stop double annotation'
  },
  release: {
    title: 'Give back as ordinary work',
    detail:
      'After double annotation ended, one person sees the records as ordinary work again: the current result and every comment, and their changes update it.',
    button: 'Give back'
  }
}

/**
 * The queue's bulk "Double annotation…" action for supervisors and admins
 * (POST /sentences/double-annotation/commands): choose the action, see how
 * many selected records it applies to and why the others are skipped, then
 * apply it.
 */
export default function DoubleCommandsModal({
  sentenceIds,
  onClose,
  onDone
}: {
  sentenceIds: string[]
  onClose: () => void
  onDone: (applied: number) => void
}) {
  const { workspaceId, api } = useWorkspacePaths()
  const [action, setAction] = useState<Action>('accept_single')
  const [reason, setReason] = useState('')
  const [fromUserId, setFromUserId] = useState<string | null>(null)
  const [toUserId, setToUserId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const members = useQuery({
    queryKey: queryKeys.members(workspaceId),
    queryFn: ({ signal }) => fetchJson<{ users: Person[] }>(api('/users'), { signal }).then(d => d.users)
  })
  const options = (members.data ?? []).map(u => ({ value: u.id, label: u.name || u.email, hint: u.role }))

  const body = () =>
    action === 'hand_over'
      ? { action, sentenceIds, fromUserId, toUserId }
      : action === 'release'
        ? { action, sentenceIds, userId: fromUserId, reason: reason.trim() || 'preview' }
        : { action, sentenceIds, reason: reason.trim() || 'preview' }
  const ready =
    action === 'hand_over'
      ? Boolean(fromUserId && toUserId && fromUserId !== toUserId)
      : action === 'release'
        ? Boolean(fromUserId)
        : true
  const preview = useQuery({
    queryKey: ['ws', workspaceId, 'double-commands-preview', action, sentenceIds.join(','), fromUserId, toUserId],
    queryFn: ({ signal }) =>
      fetchJson<Result>(api('/sentences/double-annotation/commands'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body(), dryRun: true }),
        signal
      }),
    enabled: ready,
    staleTime: 0,
    gcTime: 0
  })

  const apply = async () => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await fetchJson<Result>(api('/sentences/double-annotation/commands'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body())
      })
      onDone(result.applied)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change failed')
      setSubmitting(false)
    }
  }

  const needsReason = action !== 'hand_over'
  const canApply = ready && (!needsReason || reason.trim() !== '') && (preview.data?.applied ?? 0) > 0

  return (
    <Modal label="Double annotation" onClose={onClose}>
      <div className={`${dialogPanelClass} w-full max-w-xl p-6 space-y-4`}>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Double annotation</h2>
          <p className="text-sm text-gray-600">{sentenceIds.length.toLocaleString()} records selected</p>
        </div>
        <fieldset className="space-y-2" disabled={submitting}>
          <legend className="sr-only">Action</legend>
          {(Object.keys(ACTIONS) as Action[]).map(value => (
            <label
              key={value}
              className={`flex items-start gap-2 p-3 border text-sm cursor-pointer ${
                action === value ? 'border-indigo-600 bg-indigo-50' : 'border-gray-500'
              }`}
            >
              <input
                type="radio"
                name="double-command"
                checked={action === value}
                onChange={() => setAction(value)}
                className="mt-0.5"
              />
              <span>
                <span className="text-gray-900">{ACTIONS[value].title}</span>
                <span className="block text-gray-600">{ACTIONS[value].detail}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {action === 'release' && (
          <Combobox
            label="Person"
            options={options}
            value={fromUserId}
            onChange={setFromUserId}
            placeholder="Choose a person"
            loading={members.isPending}
            disabled={submitting}
          />
        )}

        {action === 'hand_over' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Combobox
              label="From"
              options={options}
              value={fromUserId}
              onChange={setFromUserId}
              placeholder="Choose a person"
              loading={members.isPending}
              disabled={submitting}
            />
            <Combobox
              label="To"
              options={options.filter(o => o.value !== fromUserId)}
              value={toUserId}
              onChange={setToUserId}
              placeholder="Choose a person"
              loading={members.isPending}
              disabled={submitting}
            />
          </div>
        ) : (
          <div>
            <label htmlFor="double-command-reason" className="block text-sm text-gray-700 mb-1">
              Reason
            </label>
            <input
              id="double-command-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
              disabled={submitting}
              className="w-full px-3 py-2 border border-gray-500 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </div>
        )}

        <div aria-live="polite" className="text-sm">
          {!ready ? null : preview.isPending ? (
            <span className="text-gray-600">Checking the selected records…</span>
          ) : preview.isError ? (
            <span role="alert" className="text-red-700">
              {preview.error instanceof Error ? preview.error.message : 'Could not check the records'}
            </span>
          ) : preview.data ? (
            <ul className="space-y-1 text-gray-800">
              <li>Applies to {preview.data.applied.toLocaleString()} records</li>
              {Object.entries(preview.data.skipped).map(([why, count]) => (
                <li key={why} className="text-gray-600">
                  {count.toLocaleString()} skipped: {why}
                </li>
              ))}
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
            onClick={onClose}
            disabled={submitting}
            className={buttonClass('secondary', 'md', 'flex-1')}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={submitting || !canApply}
            className={buttonClass('primary', 'md', 'flex-1')}
          >
            {submitting
              ? 'Applying…'
              : `${ACTIONS[action].button}${preview.data?.applied ? ` for ${preview.data.applied}` : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
