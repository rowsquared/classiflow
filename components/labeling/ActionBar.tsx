'use client'

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
            title="Add Comment (C)"
            aria-keyshortcuts="C"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
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
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"
              />
            </svg>
            <span className="text-sm font-medium">Flag</span>
            <span className={`${flagged ? shortcutClasses.light : shortcutClasses.dark}`}>F</span>
          </button>
          <button
            onClick={onUnknown}
            className={`${actionButtonBaseClass} ${primaryActionClasses}`}
            title="Unknown (U)"
            aria-keyshortcuts="U"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm font-medium">Unknown</span>
            <span className={shortcutClasses.dark}>U</span>
          </button>
          <button
            onClick={onSkip}
            className={`${actionButtonBaseClass} ${skipped ? skipActiveClasses : primaryActionClasses}`}
            title="Skip (S)"
            aria-keyshortcuts="S"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
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
