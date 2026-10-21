'use client'

import { useState } from 'react'
import Modal from '@/components/Modal'
import type { RecordComment } from './data'

type CommentsDialogProps = {
  comments: RecordComment[]
  showResolved: boolean
  hasResolved: boolean
  onToggleShowResolved: () => void
  onResolve: (commentId: string, resolved: boolean) => void
  onDelete: (commentId: string) => void
  /** Saves a new comment; resolves true when it was saved. */
  onAdd: (body: string) => Promise<boolean>
  onClose: () => void
}

/** The record's comments: list, resolve/reopen, delete, add. */
export default function CommentsDialog({
  comments,
  showResolved,
  hasResolved,
  onToggleShowResolved,
  onResolve,
  onDelete,
  onAdd,
  onClose
}: CommentsDialogProps) {
  const [comment, setComment] = useState('')

  const save = async () => {
    if (!comment.trim()) {
      onClose()
      return
    }
    // The new comment appears in the list above; the dialog stays open.
    if (await onAdd(comment)) setComment('')
  }

  return (
    <Modal
      label="Comments"
      onClose={onClose}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <div className="bg-white rounded-lg p-6 w-[32rem] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-gray-900">Comments</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 transition-colors"
            aria-label="Close comments"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Existing comments</span>
          <button
            onClick={onToggleShowResolved}
            className="text-xs font-medium text-indigo-700 hover:text-indigo-900 transition-colors"
          >
            {showResolved ? 'Hide resolved' : 'Show resolved'}
          </button>
        </div>
        {!showResolved && hasResolved && (
          <p className="text-xs text-gray-600 mb-3">
            Resolved comments are hidden. Click &quot;Show resolved&quot; to view them.
          </p>
        )}

        {comments.length > 0 ? (
          <ul className="mb-4 space-y-3 max-h-60 overflow-y-auto pr-1">
            {comments.map(c => (
              <li
                key={c.id}
                className={`p-3 rounded-lg border ${
                  c.resolved ? 'bg-gray-100 border-gray-300' : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div>
                    <span className="text-xs font-medium text-gray-700">{c.author.name || 'Unknown'}</span>
                    {c.resolved && <span className="ml-2 text-xs font-semibold text-green-700">Resolved</span>}
                  </div>
                  <span className="text-xs text-gray-600">{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{c.body}</p>
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => onResolve(c.id, !c.resolved)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      c.resolved
                        ? 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'
                        : 'border-green-200 text-green-700 hover:bg-green-50'
                    }`}
                  >
                    {c.resolved ? 'Reopen' : 'Mark resolved'}
                  </button>
                  <button
                    onClick={() => onDelete(c.id)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-600 mb-4">
            {showResolved ? 'No comments found.' : 'No unresolved comments yet.'}
          </p>
        )}

        <div className="mb-4">
          <label htmlFor="new-comment" className="block text-sm font-medium text-gray-700 mb-2">
            Add new comment:
          </label>
          <textarea
            id="new-comment"
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Enter your comment..."
            className="w-full p-3 border border-gray-300 rounded-md h-24 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Close
          </button>
          <button
            onClick={save}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
