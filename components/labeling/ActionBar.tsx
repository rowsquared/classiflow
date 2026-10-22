'use client'

import { ChevronsRight, CircleHelp, Flag, MessageSquare } from 'lucide-react'

type ActionBarProps = {
  hasComment: boolean
  flagged: boolean
  skipped: boolean
  canSubmit: boolean
  /** The active taxonomy or the whole record is already submitted. */
  submitted: boolean
  onComment: () => void
  onFlag: () => void
  onUnknown: () => void
  onSkip: () => void
  onSubmit: () => void
}

const actionButtonBaseClass = 'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors'
const primaryActionClasses = 'bg-indigo-600 text-white hover:bg-indigo-700'
const commentActiveClasses = 'bg-[#A7ACD9] text-[#1f2238] hover:bg-[#9ea3cf]'
const flagActiveClasses = 'bg-[#F56476] text-[#3b0a12] hover:bg-[#e8576a]'
const skipActiveClasses = 'bg-[#E8E24A] text-[#4a4510] hover:bg-[#d8d145]'
const disabledSubmitClasses = 'bg-indigo-600/40 text-white/85 cursor-not-allowed'
const submittedSubmitClasses = 'bg-[#3A67BB] text-white hover:bg-[#335aa8]'
const shortcutClasses = {
  dark: 'text-xs px-1.5 py-0.5 rounded border border-white/15 bg-white/20 text-white',
  light: 'text-xs px-1.5 py-0.5 rounded border border-black/5 bg-white/50 text-current'
}

/** The labelling actions with their keyboard shortcuts (C, F, U, S, Enter). */
export default function ActionBar({
  hasComment,
  flagged,
  skipped,
  canSubmit,
  submitted,
  onComment,
  onFlag,
  onUnknown,
  onSkip,
  onSubmit
}: ActionBarProps) {
  return (
    <div className="mt-auto">
      <div className="sticky bottom-0 border-t border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onComment}
            className={`${actionButtonBaseClass} ${hasComment ? commentActiveClasses : primaryActionClasses}`}
            title="Add comment (C)"
            aria-keyshortcuts="C"
          >
            <MessageSquare className="w-4 h-4" aria-hidden="true" />
            <span className="text-sm font-medium">Comment</span>
            <span className={`${hasComment ? shortcutClasses.light : shortcutClasses.dark}`}>C</span>
          </button>
          <button
            onClick={onFlag}
            className={`${actionButtonBaseClass} ${flagged ? flagActiveClasses : primaryActionClasses}`}
            title="Flag/Unflag (F)"
            aria-pressed={flagged}
            aria-keyshortcuts="F"
          >
            <Flag className="w-4 h-4" aria-hidden="true" />
            <span className="text-sm font-medium">Flag</span>
            <span className={`${flagged ? shortcutClasses.light : shortcutClasses.dark}`}>F</span>
          </button>
          <button
            onClick={onUnknown}
            className={`${actionButtonBaseClass} ${primaryActionClasses}`}
            title="Unknown (U)"
            aria-keyshortcuts="U"
          >
            <CircleHelp className="w-4 h-4" aria-hidden="true" />
            <span className="text-sm font-medium">Unknown</span>
            <span className={shortcutClasses.dark}>U</span>
          </button>
          <button
            onClick={onSkip}
            className={`${actionButtonBaseClass} ${skipped ? skipActiveClasses : primaryActionClasses}`}
            title="Skip (S)"
            aria-keyshortcuts="S"
          >
            <ChevronsRight className="w-4 h-4" aria-hidden="true" />
            <span className="text-sm font-medium">Skip</span>
            <span className={`${skipped ? shortcutClasses.light : shortcutClasses.dark}`}>S</span>
          </button>
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className={`ml-auto flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
              submitted ? submittedSubmitClasses : canSubmit ? primaryActionClasses : disabledSubmitClasses
            }`}
            title="Submit (Enter)"
            aria-keyshortcuts="Enter"
          >
            <span className="text-sm font-medium">Submit</span>
            <div
              className={`flex h-5 w-5 items-center justify-center rounded ${
                submitted || canSubmit ? shortcutClasses.dark : `${shortcutClasses.dark} opacity-70 text-white/80`
              }`}
            >
              ↵
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
