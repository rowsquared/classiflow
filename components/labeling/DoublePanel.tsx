'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Combobox from '@/components/ui/Combobox'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetch'
import { buttonClass, badgeClass, type BadgeTone } from '@/components/ui/styles'
import { OUTCOME_LABELS, firstDifferingLevel, type DoubleRecordView, type OutcomeState } from '@/lib/double-annotation'

type ManagerView = Extract<DoubleRecordView, { mode: 'manager' }>

/** Manager commands (POST /sentences/[id]/double-annotation). */
export type DoubleCommand =
  { action: 'accept_single' | 'stop'; reason: string } | { action: 'reassign'; position: number; userId: string }
type Labels = Array<{ level: number; nodeCode: string; nodeLabel?: string | null }>

const TONES: Record<OutcomeState, BadgeTone> = {
  waiting: 'info',
  agreed: 'accent',
  disagreed: 'warn',
  reviewed: 'accent',
  accepted_single: 'neutral'
}

const PART_STATUS: Record<string, string> = { submitted: 'done', pending: 'to do', skipped: 'skipped' }

/**
 * Double annotation on the labelling screen.
 * - Labellers (task/hidden): a one-line notice; their own answer is all they see.
 * - Managers: the active taxonomy's two answers side by side with the first
 *   difference marked, "Use this answer" buttons (or choose another path
 *   below and submit), and the record-level actions: accept the single label
 *   or stop double annotation, each with a reason.
 */
export default function DoublePanel({
  view,
  taxonomyKey,
  busy,
  onUseAnswer,
  onCommand
}: {
  view: DoubleRecordView
  taxonomyKey: string
  busy: boolean
  onUseAnswer: (labels: Labels) => void
  onCommand: (body: DoubleCommand) => Promise<boolean>
}) {
  if (view.mode === 'task') {
    const done = view.answered.includes(taxonomyKey)
    return (
      <div className="px-4 py-2 border-b border-gray-200 bg-[#E3EBFB] text-sm text-[#28498c]" role="note">
        Independent labelling: you see only your own answer.{' '}
        {done ? 'Your answer for this taxonomy is submitted and final.' : 'Once submitted, an answer is final.'}
      </div>
    )
  }
  if (view.mode === 'hidden') {
    return (
      <div className="px-4 py-2 border-b border-gray-200 bg-gray-100 text-sm text-gray-800" role="note">
        Two other people are labelling this record independently, so its labels are hidden.
      </div>
    )
  }
  return (
    <ManagerPanel view={view} taxonomyKey={taxonomyKey} busy={busy} onUseAnswer={onUseAnswer} onCommand={onCommand} />
  )
}

function ManagerPanel({
  view,
  taxonomyKey,
  busy,
  onUseAnswer,
  onCommand
}: {
  view: ManagerView
  taxonomyKey: string
  busy: boolean
  onUseAnswer: (labels: Labels) => void
  onCommand: (body: DoubleCommand) => Promise<boolean>
}) {
  const [pending, setPending] = useState<'accept_single' | 'stop' | 'reassign' | null>(null)
  // Parts nobody has started (no answer yet) can go to someone else.
  const handOver = view.tasks.filter(
    t => t.status !== 'submitted' && !view.outcomes.some(o => o.answers.some(a => a.position === t.position))
  )
  const [reason, setReason] = useState('')
  const outcome = view.outcomes.find(o => o.taxonomyKey === taxonomyKey)
  const person = (position: number) => view.tasks.find(t => t.position === position)
  const [first, second] = outcome?.answers ?? []
  const differs = first && second ? firstDifferingLevel(first.labels, second.labels) : null
  const canAccept =
    view.canReview &&
    view.outcomes.every(o => o.state !== 'disagreed') &&
    view.outcomes.every(o => o.state !== 'waiting' || o.answers.length > 0) &&
    view.outcomes.some(o => o.state === 'waiting')

  const submitCommand = async () => {
    if (!pending || !reason.trim()) return
    if (pending === 'reassign') return
    if (await onCommand({ action: pending, reason: reason.trim() })) {
      setPending(null)
      setReason('')
    }
  }

  return (
    <section aria-label="Double annotation" className="px-4 py-3 border-b border-gray-200 bg-gray-50 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-gray-900">Double annotation</span>
        {outcome && <span className={badgeClass(TONES[outcome.state])}>{OUTCOME_LABELS[outcome.state]}</span>}
        <span className="text-gray-700">
          {view.tasks
            .map(t => `${t.assignee?.name ?? 'Former member'}: ${PART_STATUS[t.status] ?? t.status}`)
            .join(' · ')}
        </span>
      </div>

      {outcome && outcome.answers.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {outcome.answers.map(answer => {
            const task = person(answer.position)
            return (
              <div key={answer.position} className="bg-white border border-gray-200 p-3 text-sm">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-medium text-gray-900">
                    {task?.assignee?.name ?? 'Former member'}
                    {task?.fromBaseline && <span className="font-normal text-gray-600"> (existing labels)</span>}
                    {outcome.sourcePosition === answer.position && outcome.state !== 'agreed' && (
                      <span className="font-normal text-gray-600"> · current result</span>
                    )}
                  </span>
                  {view.canReview && outcome.state === 'disagreed' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onUseAnswer(answer.labels)}
                      className={buttonClass('secondary', 'sm')}
                    >
                      Use this answer
                    </button>
                  )}
                </div>
                <ol className="space-y-0.5">
                  {answer.labels.map(l => (
                    <li
                      key={l.level}
                      className={differs !== null && l.level >= differs ? 'text-[#4d470b] bg-[#F7F3B3] px-1' : 'px-1'}
                    >
                      <span className="text-gray-600">{l.level}.</span> <span className="font-mono">{l.nodeCode}</span>{' '}
                      {l.nodeLabel}
                    </li>
                  ))}
                </ol>
              </div>
            )
          })}
        </div>
      )}

      {outcome?.state === 'disagreed' && view.canReview && (
        <p className="text-sm text-gray-700">
          Pick one answer, or choose another label below and submit it as the decision.
          {differs !== null && ` The answers differ from level ${differs}.`}
        </p>
      )}
      {outcome?.state === 'reviewed' && outcome.reviewedBy && (
        <p className="text-sm text-gray-700">
          Decided by {outcome.reviewedBy}
          {outcome.note ? `: ${outcome.note}` : ''}. Submitting another label below changes the decision.
        </p>
      )}
      {!view.canReview && (
        <p className="text-sm text-gray-700">
          You cannot decide this record: you labelled it, or one of its labellers is outside your team.
        </p>
      )}

      {view.canReview && (
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
