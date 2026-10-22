'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Modal from '@/components/Modal'
import { CopyRecordLink } from '@/components/CopyRecordLink'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'
import { useUnsavedChanges } from '@/lib/unsaved-changes'
import type { RecordComment } from './data'
import { X } from 'lucide-react'

const mobileQuery = '(max-width: 767px)'
function subscribe(listener: () => void) {
  const query = window.matchMedia(mobileQuery)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

type CommentsDialogProps = {
  open: boolean
  workspaceId: string
  sentenceId: string
  comments: RecordComment[]
  showResolved: boolean
  hasResolved: boolean
  loading: boolean
  error: boolean
  onRetry: () => void
  onToggleShowResolved: () => void
  onResolve: (commentId: string, resolved: boolean) => Promise<boolean>
  onDelete: (commentId: string) => Promise<boolean>
  onAdd: (body: string) => Promise<boolean>
  onClose: () => void
}

/** One discussion, inline on desktop and in a dialog on small screens. */
export default function CommentsDialog({
  open,
  workspaceId,
  sentenceId,
  comments,
  showResolved,
  hasResolved,
  loading,
  error,
  onRetry,
  onToggleShowResolved,
  onResolve,
  onDelete,
  onAdd,
  onClose
}: CommentsDialogProps) {
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const composer = useRef<HTMLTextAreaElement>(null)
  const mobile = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(mobileQuery).matches,
    () => false
  )
  useUnsavedChanges(Boolean(comment.trim()))
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    composer.current?.focus()
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open, mobile])
  // Saving disables the focused control, which can leave focus on the document.
  // Escape still closes the inline discussion; nested dialogs handle their own Escape.
  useEffect(() => {
    if (!open || mobile) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || busy.current) return
      if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]')) return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [open, mobile, onClose])
  const run = async (operation: () => Promise<boolean>) => {
    if (busy.current) return false
    busy.current = true
    setSaving(true)
    try {
      return await operation()
    } finally {
      busy.current = false
      setSaving(false)
    }
  }
  const close = () => {
    if (!busy.current) onClose()
  }
  if (!open) return null
  const content = (
    <section
      id="record-comments"
      aria-label="Comments"
      data-record-comments
      className={
        mobile
          ? `${dialogPanelClass} p-5 w-[32rem] max-w-full max-h-[85dvh] overflow-y-auto`
          : 'border-b border-gray-200 bg-indigo-50/40 p-5'
      }
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          close()
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-medium text-gray-900">Comments</h2>
        <button
          type="button"
          disabled={saving}
          onClick={close}
          className={buttonClass('ghost', 'sm')}
          aria-label="Close comments"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <CopyRecordLink workspaceId={workspaceId} sentenceId={sentenceId} discussion />
        {(hasResolved || showResolved) && (
          <button
            type="button"
            onClick={onToggleShowResolved}
            disabled={saving}
            className={buttonClass('ghost', 'sm')}
            aria-pressed={showResolved}
          >
            {showResolved ? 'Hide resolved' : 'Show resolved'}
          </button>
        )}
      </div>
      {loading ? (
        <p role="status" className="text-sm text-gray-600 mb-3">
          Loading comments…
        </p>
      ) : error ? (
        <div role="alert" className="text-sm text-red-700 mb-3">
          Could not load comments.{' '}
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : comments.length ? (
        <ul className="space-y-3 mb-4">
          {comments.map(c => (
            <li key={c.id} className="border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2 text-xs text-gray-600">
                <span className="font-medium text-gray-900">{c.author.name || 'Unknown'}</span>
                <time dateTime={c.createdAt}>{new Date(c.createdAt).toLocaleString()}</time>
                {c.resolved && <span className="text-green-700">Resolved</span>}
              </div>
              <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">{c.body}</p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={saving}
                  className={buttonClass('secondary', 'sm')}
                  onClick={() => run(() => onResolve(c.id, !c.resolved))}
                >
                  {c.resolved ? 'Reopen' : 'Mark resolved'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className={buttonClass('ghost', 'sm', 'text-red-700')}
                  onClick={() => run(() => onDelete(c.id))}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-600 mb-4">
          {showResolved
            ? 'No comments found.'
            : hasResolved
              ? 'All comments are resolved. Choose “Show resolved” to view them.'
              : 'No unresolved comments yet.'}
        </p>
      )}
      <form
        onSubmit={async e => {
          e.preventDefault()
          if (!comment.trim()) return
          if (await run(() => onAdd(comment))) setComment('')
        }}
      >
        <label htmlFor="new-comment" className="block text-sm font-medium text-gray-900 mb-2">
          Add new comment
        </label>
        <textarea
          ref={composer}
          id="new-comment"
          maxLength={10000}
          disabled={saving}
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Enter your comment..."
          className="w-full p-3 border border-gray-500 h-24 text-sm text-gray-900 bg-white placeholder-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
        />
        <div className="mt-3 flex justify-end">
          <button type="submit" disabled={saving || !comment.trim()} className={buttonClass('primary', 'sm')}>
            {saving ? 'Saving…' : 'Save comment'}
          </button>
        </div>
      </form>
    </section>
  )
  return mobile ? (
    <Modal label="Comments" onClose={close}>
      {content}
    </Modal>
  ) : (
    content
  )
}
