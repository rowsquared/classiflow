import { sameLabels, type LabelInput } from '@/lib/label-path'

/**
 * Double annotation rules (docs/plans/double-annotation.md), pure and shared by
 * the server (lib/server/double-annotation.ts), the queue and the export.
 *
 * Two people label a record independently. Per required taxonomy:
 * - the first answer to arrive is the record's result straight away
 *   (provisional, exported), and stays the result while the second is missing
 *   or disagrees;
 * - two identical paths are agreed (confirmed); two different paths need a
 *   supervisor's or admin's review, whose choice is the confirmed result;
 * - a manager can waive the second answer (accepted_single) when nothing
 *   disagrees.
 * Unknown codes are ordinary terminal choices: two identical unknown paths agree.
 */

export type OutcomeState = 'waiting' | 'agreed' | 'disagreed' | 'reviewed' | 'accepted_single'

export const CONFIRMED_STATES: readonly OutcomeState[] = ['agreed', 'reviewed', 'accepted_single']

export function isConfirmed(state: OutcomeState): boolean {
  return CONFIRMED_STATES.includes(state)
}

/** The state after a second answer arrives: the original comparison. */
export function compareAnswers(first: LabelInput[], second: LabelInput[]): { state: OutcomeState; matched: boolean } {
  const matched = sameLabels(first, second)
  return { state: matched ? 'agreed' : 'disagreed', matched }
}

/**
 * How deep two compared paths (codes by level) agree: the number of leading
 * levels with the same code, or 5 (every level) when the paths are
 * identical, also when they end early (e.g. both unknown at level 1).
 */
export function agreementDepth(a: string[], b: string[]): number {
  if (a.length === b.length && a.every((c, i) => c === b[i])) return 5
  let depth = 0
  while (depth < Math.min(a.length, b.length) && a[depth] === b[depth]) depth++
  return depth
}

/**
 * Chance-corrected agreement of compared pairs: Fleiss' kappa for two ratings
 * per record. Every record's pair is two different people, not the same two
 * raters throughout, so the chance term uses the codes of all answers pooled
 * (Cohen's kappa would assume one fixed rater per position). Feed one
 * category per answer with add(); value() is null without pairs or when every
 * answer has the same category (chance agreement 1).
 */
export class KappaTally {
  private pairs = 0
  private same = 0
  private readonly counts = new Map<string, number>()

  add(a: string, b: string) {
    this.pairs++
    if (a === b) this.same++
    this.counts.set(a, (this.counts.get(a) ?? 0) + 1)
    this.counts.set(b, (this.counts.get(b) ?? 0) + 1)
  }

  value(): number | null {
    if (this.pairs === 0) return null
    const ratings = this.pairs * 2
    let expected = 0
    for (const count of this.counts.values()) expected += (count / ratings) ** 2
    if (expected >= 1) return null
    return (this.same / this.pairs - expected) / (1 - expected)
  }
}

/**
 * Kappa per level and for the full path, from compared paths (codes by
 * level). The category at level L is the path up to L, so two answers agree
 * at L exactly when agreementDepth() reaches L (paths that end early included).
 */
export class LevelKappa {
  private readonly levels = Array.from({ length: 5 }, () => new KappaTally())
  private readonly full = new KappaTally()

  add(a: string[], b: string[]) {
    const prefix = (path: string[], level: number) => JSON.stringify(path.slice(0, level))
    this.levels.forEach((tally, i) => tally.add(prefix(a, i + 1), prefix(b, i + 1)))
    this.full.add(prefix(a, 5), prefix(b, 5))
  }

  /** Kappa for levels 1..depth (null where undefined). */
  byLevel(depth: number): Array<number | null> {
    return this.levels.slice(0, depth).map(t => t.value())
  }

  fullPath(): number | null {
    return this.full.value()
  }
}

/** First level at which two paths differ (1-based), or null when they are the same path. */
export function firstDifferingLevel(a: LabelInput[], b: LabelInput[]): number | null {
  const byLevel = (labels: LabelInput[]) => new Map(labels.map(l => [l.level, l.nodeCode]))
  const left = byLevel(a)
  const right = byLevel(b)
  const depth = Math.max(left.size, right.size)
  for (let level = 1; level <= depth; level++) {
    if (left.get(level) !== right.get(level)) return level
  }
  return null
}

/**
 * The record's double-annotation summary for queues, filters and the export:
 * - review: at least one taxonomy disagrees (wins over waiting);
 * - waiting: a taxonomy still waits for an answer;
 * - confirmed: every required taxonomy is confirmed.
 */
export type RoundSummary = 'review' | 'waiting' | 'confirmed'

export function summarizeOutcomes(states: OutcomeState[]): RoundSummary {
  if (states.some(s => s === 'disagreed')) return 'review'
  if (states.length > 0 && states.every(isConfirmed)) return 'confirmed'
  return 'waiting'
}

/** A queue row's double annotation, for managers (lib/server/double-queue.ts). */
export type DoubleRowSummary = {
  state: 'waiting' | 'review' | 'agreed' | 'resolved' | 'accepted'
  /** Parts submitted, of two. */
  done: number
  /** A part was skipped or its person no longer exists: someone must take it over. */
  gap: boolean
  people: Array<{ name: string; status: string }>
  /** Disagreeing taxonomies: the deepest code of each answer and the first differing level. */
  disputes: Array<{ taxonomyKey: string; a: string; b: string; level: number }>
  /** Days since the round started, while a part is still to do. */
  waitingDays: number | null
}

/** Labels for queue badges and the record screen (sentence case, no colour needed to read them). */
export const OUTCOME_LABELS: Record<OutcomeState, string> = {
  waiting: 'Waiting for labels',
  agreed: 'Agreed',
  disagreed: 'Needs review',
  reviewed: 'Resolved',
  accepted_single: 'Single label accepted'
}

/**
 * Export / API status per taxonomy (section 9 of the plan, simplified):
 * `single` for ordinary labels, `unlabelled` without labels, `provisional`
 * for a label that waits for double annotation (one answer so far, or labels
 * from before the round), else the outcome state.
 */
export type TaxonomyAnnotationStatus =
  'unlabelled' | 'single' | 'provisional' | 'disagreed' | 'agreed' | 'reviewed' | 'accepted_single'

const sameCodes = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i])

export function taxonomyStatus(opts: {
  /** The taxonomy's outcome in the record's latest round that was not stopped, if any. */
  outcome: { state: OutcomeState; resultCodes?: string[] } | null
  hasLabels: boolean
  /** The record's current label codes for the taxonomy, by level. */
  codes?: string[]
}): TaxonomyAnnotationStatus {
  const { outcome, hasLabels, codes } = opts
  if (!outcome) return hasLabels ? 'single' : 'unlabelled'
  if (outcome.state === 'waiting') return hasLabels ? 'provisional' : 'unlabelled'
  // Labels changed after the confirmation by someone who could not decide: ordinary labels.
  const result = outcome.resultCodes ?? []
  if (isConfirmed(outcome.state) && result.length > 0 && codes && !sameCodes(codes, result)) {
    return hasLabels ? 'single' : 'unlabelled'
  }
  return outcome.state
}

/** Record-level status: unlabelled, partial, provisional, needs_review or confirmed. */
export type RecordAnnotationStatus = 'unlabelled' | 'partial' | 'provisional' | 'needs_review' | 'confirmed'

export function recordStatus(statuses: TaxonomyAnnotationStatus[]): RecordAnnotationStatus {
  if (statuses.length === 0 || statuses.every(s => s === 'unlabelled')) return 'unlabelled'
  if (statuses.includes('disagreed')) return 'needs_review'
  if (statuses.includes('unlabelled')) return 'partial'
  if (statuses.includes('provisional')) return 'provisional'
  return 'confirmed'
}

type PathView = Array<{ level: number; nodeCode: string; nodeLabel: string | null }>

/** Ordinary edit permissions, without disclosing the annotation workflow. */
export type RecordLabelingAccess = { editableTaxonomies: string[] | null }

/** Managers and ordinary records: no restriction; a record without a part in an active round: none. */
export function recordLabelingAccess(view: DoubleRecordView | null): RecordLabelingAccess {
  return { editableTaxonomies: view?.mode === 'hidden' ? [] : null }
}

/**
 * A participant may change their answer for every taxonomy the round
 * requires: no restriction (as on ordinary records) when that is every active
 * taxonomy, else the required ones.
 */
export function participantLabelingAccess(required: string[], active: string[]): RecordLabelingAccess {
  return { editableTaxonomies: active.every(key => required.includes(key)) ? null : required }
}

/** The record screen's view of an active round (record GET `double`; lib/server/double-annotation.ts recordView). */
export type DoubleRecordView =
  | { mode: 'hidden' }
  | {
      mode: 'manager'
      roundId: string
      /** active, or closed: completed (confirmed) or cancelled (stopped); closed rounds are history. */
      status: 'active' | 'completed' | 'cancelled'
      closeReason: string | null
      closedAt: string | null
      canReview: boolean
      /** People who held a part before it was handed over. */
      former: Array<{ position: number; name: string }>
      tasks: Array<{
        position: number
        status: string
        fromBaseline: boolean
        /** Given back as ordinary work (the person no longer participates). */
        releasedAt: string | null
        assignee: { id: string; name: string } | null
      }>
      outcomes: Array<{
        taxonomyKey: string
        state: OutcomeState
        matched: boolean | null
        /** A labeller changed their answer after the comparison. */
        revisedAfterCompare: boolean
        sourcePosition: number | null
        reviewedBy: string | null
        reviewedAt: string | null
        comparedAt: string | null
        note: string | null
        /** The confirmed path, by level (empty while not confirmed). */
        resultCodes: string[]
        answers: Array<{ position: number; labels: PathView }>
      }>
    }
