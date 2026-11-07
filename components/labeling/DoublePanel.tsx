'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Combobox from '@/components/ui/Combobox'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetch'
import { buttonClass, badgeClass, type BadgeTone } from '@/components/ui/styles'
import { OUTCOME_LABELS, firstDifferingLevel, type DoubleRecordView, type OutcomeState } from '@/lib/double-annotation'

export type ManagerView = Extract<DoubleRecordView, { mode: 'manager' }>
type Outcome = ManagerView['outcomes'][number]

/** Manager commands (POST /sentences/[id]/double-annotation). */
export type DoubleCommand =
  | { action: 'accept_single' | 'stop'; reason: string }
  | { action: 'reassign'; position: number; userId: string }
  | { action: 'reopen'; taxonomyKey: string }

/** The reviewer's choice for a disagreement: answer A, answer B or another label. */
export type ReviewChoice = 'a' | 'b' | 'other'
export type ReviewState = { choice: ReviewChoice | null; note: string; override: boolean }
export const EMPTY_REVIEW: ReviewState = { choice: null, note: '', override: false }

export const OUTCOME_TONES: Record<OutcomeState, BadgeTone> = {
  waiting: 'info',
  agreed: 'accent',
  disagreed: 'warn',
  reviewed: 'accent',
  accepted_single: 'neutral'
}

const PART_STATUS: Record<string, string> = { submitted: 'done', pending: 'to do', skipped: 'skipped' }
const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

/** What a manager may do with the active taxonomy's outcome. */
export function reviewMode(view: ManagerView, outcome: Outcome | undefined): 'decide' | 'change' | null {
  if (!outcome || !view.canReview || view.status === 'cancelled') return null
  if (view.status === 'active' && outcome.state === 'disagreed') return 'decide'
  if (outcome.state === 'agreed' || outcome.state === 'reviewed' || outcome.state === 'accepted_single') return 'change'
  return null
}

/**
 * Double annotation on the labelling screen, for supervisors and admins who
 * do not label the record themselves (participants never get this panel).
 * - Both answers aligned level by level, from the first difference marked.
 * - A disagreement is decided explicitly: answer A (key 1), answer B (2) or
 *   another label (3, chosen in the browser below), with an optional note.
 * - A confirmed result changes only through "Change confirmed result…" with
 *   a reason; a decision can be undone.
 * - Closed rounds stay visible as history.
 */
export default function DoublePanel({
  view,
  taxonomyKey,
  busy,
  review,
  onReviewChange,
  onCommand
}: {
  view: ManagerView
  taxonomyKey: string
  busy: boolean
  review: ReviewState
  onReviewChange: (review: ReviewState) => void
  onCommand: (body: DoubleCommand) => Promise<boolean>
}) {
  const [pending, setPending] = useState<'accept_single' | 'stop' | 'reassign' | null>(null)
  const [reason, setReason] = useState('')
  const outcome = view.outcomes.find(o => o.taxonomyKey === taxonomyKey)
  const active = view.status === 'active'
  const mode = reviewMode(view, outcome)
  // Parts nobody has started (no answer yet) can go to someone else.
  const handOver = view.tasks.filter(
    t => t.status !== 'submitted' && !view.outcomes.some(o => o.answers.some(a => a.position === t.position))
  )
  const canAccept =
    active &&
    view.canReview &&
    view.outcomes.every(o => o.state !== 'disagreed') &&
    view.outcomes.every(o => o.state !== 'waiting' || o.answers.length > 0) &&
    view.outcomes.some(o => o.state === 'waiting')

  const submitCommand = async () => {
    if (!pending || pending === 'reassign' || !reason.trim()) return
    if (await onCommand({ action: pending, reason: reason.trim() })) {
      setPending(null)
      setReason('')
    }
  }

  return (
    <section aria-label="Double annotation" className="px-4 py-3 border-b border-gray-200 bg-gray-50 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-gray-900">{active ? 'Double annotation' : 'Double annotation history'}</span>
        {outcome && <span className={badgeClass(OUTCOME_TONES[outcome.state])}>{OUTCOME_LABELS[outcome.state]}</span>}
        <span className="text-gray-700">
          {view.tasks
            .map(t => `${t.assignee?.name ?? 'Former member'}: ${PART_STATUS[t.status] ?? t.status}`)
            .join(' · ')}
        </span>
      </div>
      {!active && (
        <p className="text-sm text-gray-700">
          {view.status === 'completed' ? 'Confirmed' : 'Stopped'}
          {view.closedAt ? ` on ${formatDate(view.closedAt)}` : ''}
          {view.closeReason ? `: ${view.closeReason}` : '.'}
        </p>
      )}
      {view.former.length > 0 && (
        <p className="text-sm text-gray-700">
          Handed over: {view.former.map(f => `${f.name} (${f.position === 1 ? 'A' : 'B'})`).join(', ')}
        </p>
      )}

      {outcome && outcome.answers.length > 0 && <Comparison view={view} outcome={outcome} />}

      {outcome?.revisedAfterCompare && (
        <p className="text-sm text-gray-700">
          A labeller changed their answer after the two answers were compared. The answers above are the current ones;
          the comparison counts the original ones.
        </p>
      )}
      {outcome && (outcome.state === 'reviewed' || outcome.state === 'accepted_single') && outcome.reviewedBy && (
        <p className="text-sm text-gray-700">
          {outcome.state === 'reviewed' ? 'Decided' : 'Single label accepted'} by {outcome.reviewedBy}
          {outcome.reviewedAt ? ` on ${formatDate(outcome.reviewedAt)}` : ''}
          {outcome.note ? `: “${outcome.note}”` : '.'}
          {outcome.resultCodes.length > 0 && (
            <>
              {' '}
              Result <span className="font-mono">{outcome.resultCodes.join(' › ')}</span>.
            </>
          )}
        </p>
      )}
      {!view.canReview && (
        <p className="text-sm text-gray-700">
          You cannot decide this record: you labelled it, or one of its labellers is outside your team.
        </p>
      )}

      {mode === 'decide' && outcome && (
        <DecisionForm outcome={outcome} view={view} busy={busy} review={review} onChange={onReviewChange} />
      )}

      {mode === 'change' && outcome && (
        <div className="space-y-2">
          {review.override ? (
            <>
              <label htmlFor="double-override-reason" className="block text-xs text-gray-700">
                Why change the confirmed result? Choose the new label below, then submit.
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="double-override-reason"
                  value={review.note}
                  onChange={e => onReviewChange({ ...review, note: e.target.value })}
                  maxLength={2000}
                  className="flex-1 min-w-48 px-2 py-1.5 border border-gray-500 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onReviewChange({ ...review, override: false, note: '' })}
                  className={buttonClass('secondary', 'sm')}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onReviewChange({ choice: null, note: '', override: true })}
                className={buttonClass('secondary', 'sm')}
              >
                Change confirmed result…
              </button>
              {outcome.state === 'reviewed' && outcome.matched !== null && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onCommand({ action: 'reopen', taxonomyKey })}
                  className={buttonClass('ghost', 'sm')}
                >
                  Undo decision
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {active && view.canReview && (
        <div className="flex flex-wrap items-end gap-2">
          {pending === 'reassign' ? (
            <HandOverForm
              parts={handOver}
              taken={view.tasks.flatMap(t => (t.assignee ? [t.assignee.id] : []))}
              busy={busy}
              onCancel={() => setPending(null)}
              onSubmit={async (position, userId) => {
                if (await onCommand({ action: 'reassign', position, userId })) setPending(null)
              }}
            />
          ) : pending ? (
            <>
              <div className="flex-1 min-w-48">
                <label htmlFor="double-reason" className="block text-xs text-gray-700 mb-1">
                  {pending === 'accept_single' ? 'Why is one label enough?' : 'Why stop double annotation?'}
                </label>
                <input
                  id="double-reason"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  maxLength={500}
                  className="w-full px-2 py-1.5 border border-gray-500 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                />
              </div>
              <button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={submitCommand}
                className={buttonClass('primary', 'sm')}
              >
                {pending === 'accept_single' ? 'Accept single label' : 'Stop double annotation'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPending(null)}
                className={buttonClass('secondary', 'sm')}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {canAccept && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPending('accept_single')}
                  className={buttonClass('secondary', 'sm')}
                >
                  Accept single label…
                </button>
              )}
              {handOver.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPending('reassign')}
                  className={buttonClass('secondary', 'sm')}
                >
                  Hand over a part…
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setPending('stop')}
                className={buttonClass('ghost', 'sm')}
              >
                Stop double annotation…
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}

/** The answers aligned by level; rows from the first difference are marked. */
function Comparison({ view, outcome }: { view: ManagerView; outcome: Outcome }) {
  const [first, second] = outcome.answers
  const differs = first && second ? firstDifferingLevel(first.labels, second.labels) : null
  const depth = Math.max(...outcome.answers.map(a => Math.max(...a.labels.map(l => l.level))))
  const name = (position: number) => {
    const task = view.tasks.find(t => t.position === position)
    const person = task?.assignee?.name ?? 'Former member'
    return `${position === 1 ? 'A' : 'B'} · ${person}${task?.fromBaseline ? ' (existing labels)' : ''}`
  }
  return (
    <div className="overflow-x-auto bg-white border border-gray-200">
      <table className="w-full text-sm">
        <caption className="sr-only">Answers by level for {outcome.taxonomyKey}</caption>
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-700">
            <th scope="col" className="py-1.5 px-2 font-medium w-14">
              Level
            </th>
            {outcome.answers.map(a => (
              <th key={a.position} scope="col" className="py-1.5 px-2 font-medium">
                {name(a.position)}
                {outcome.sourcePosition === a.position && outcome.state !== 'agreed' && view.status === 'active' && (
                  <span className="font-normal text-gray-600"> · current result</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: depth }, (_, i) => i + 1).map(level => {
            const marked = differs !== null && level >= differs
            return (
              <tr
                key={level}
                className={marked ? 'bg-[#F7F3B3] text-[#4d470b]' : 'border-b border-gray-100 last:border-0'}
              >
                <td className="py-1 px-2">
                  {level}
                  {marked && <span className="sr-only"> (differs)</span>}
                </td>
                {outcome.answers.map(a => {
                  const label = a.labels.find(l => l.level === level)
                  return (
                    <td key={a.position} className="py-1 px-2">
                      {label ? (
                        <>
                          <span className="font-mono">{label.nodeCode}</span> {label.nodeLabel}
                        </>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Answer A (1), answer B (2) or another label (3), plus an optional note. Submitting saves the decision. */
function DecisionForm({
  outcome,
  view,
  busy,
  review,
  onChange
}: {
  outcome: Outcome
  view: ManagerView
  busy: boolean
  review: ReviewState
  onChange: (review: ReviewState) => void
}) {
  const options: Array<{ value: ReviewChoice; title: string; detail: string; key: string }> = [
    ...outcome.answers.map(a => {
      const deepest = a.labels[a.labels.length - 1]
      const person = view.tasks.find(t => t.position === a.position)?.assignee?.name ?? 'Former member'
      return {
        value: (a.position === 1 ? 'a' : 'b') as ReviewChoice,
        title: `Use ${a.position === 1 ? 'A' : 'B'} (${person})`,
        detail: deepest ? `${deepest.nodeCode} ${deepest.nodeLabel ?? ''}` : '',
        key: a.position === 1 ? '1' : '2'
      }
    }),
    { value: 'other', title: 'Other label', detail: 'Choose it in the browser below', key: '3' }
  ]
  return (
    <fieldset className="space-y-2" disabled={busy}>
      <legend className="text-sm text-gray-900 mb-1">Decision (keys 1, 2, 3; Enter saves)</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <label
            key={option.value}
            className={`flex-1 min-w-40 flex items-start gap-2 px-3 py-2 border text-sm cursor-pointer ${
              review.choice === option.value ? 'border-indigo-600 bg-indigo-50' : 'border-gray-500 bg-white'
            }`}
          >
            <input
              type="radio"
              name="double-decision"
              value={option.value}
              checked={review.choice === option.value}
              onChange={() => onChange({ ...review, choice: option.value })}
              className="mt-0.5"
            />
            <span>
              <span className="text-gray-900">
                {option.title} <kbd className="text-xs text-gray-600">{option.key}</kbd>
              </span>
              <span className="block text-gray-700">{option.detail}</span>
            </span>
          </label>
        ))}
      </div>
      <label htmlFor="double-note" className="block text-xs text-gray-700">
        Note (optional, kept with the decision)
      </label>
      <input
        id="double-note"
        value={review.note}
        onChange={e => onChange({ ...review, note: e.target.value })}
        maxLength={2000}
        className="w-full px-2 py-1.5 border border-gray-500 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      />
    </fieldset>
  )
}

type Part = ManagerView['tasks'][number]

/** Choose an unstarted part and the person who takes it over (people the caller may assign). */
function HandOverForm({
  parts,
  taken,
  busy,
  onCancel,
  onSubmit
}: {
  parts: Part[]
  taken: string[]
  busy: boolean
  onCancel: () => void
  onSubmit: (position: number, userId: string) => Promise<void>
}) {
  const { workspaceId, api } = useWorkspacePaths()
  const [position, setPosition] = useState(parts[0]?.position ?? 1)
  const [userId, setUserId] = useState<string | null>(null)
  const members = useQuery({
    queryKey: queryKeys.members(workspaceId),
    queryFn: ({ signal }) =>
      fetchJson<{ users: Array<{ id: string; name: string | null; email: string; role: string }> }>(api('/users'), {
        signal
      }).then(d => d.users)
  })
  // Never the people who already hold a part: the two labels come from two different people.
  const options = (members.data ?? [])
    .filter(u => !taken.includes(u.id))
    .map(u => ({ value: u.id, label: u.name || u.email, hint: u.role }))
  return (
    <>
      {parts.length > 1 && (
        <div>
          <label htmlFor="double-part" className="block text-xs text-gray-700 mb-1">
            Part
          </label>
          <select
            id="double-part"
            value={position}
            onChange={e => setPosition(Number(e.target.value))}
            className="px-2 py-1.5 border border-gray-500 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {parts.map(p => (
              <option key={p.position} value={p.position}>
                {p.assignee?.name ?? 'Former member'}
              </option>
            ))}
          </select>
        </div>
      )}
      <Combobox
        label={`Hand ${parts.find(p => p.position === position)?.assignee?.name ?? 'this part'}'s part to`}
        options={options}
        value={userId}
        onChange={value => setUserId(value)}
        placeholder="Choose a person"
        loading={members.isPending}
        className="flex-1 min-w-48"
        labelClassName="block text-xs text-gray-700 mb-1"
      />
      <button
        type="button"
        disabled={busy || !userId}
        onClick={() => userId && void onSubmit(position, userId)}
        className={buttonClass('primary', 'sm')}
      >
        Hand over
      </button>
      <button type="button" disabled={busy} onClick={onCancel} className={buttonClass('secondary', 'sm')}>
        Cancel
      </button>
    </>
  )
}
