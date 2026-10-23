'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Link as LinkIcon } from 'lucide-react'
import { buttonClass } from '@/components/ui/styles'
import { recordPath } from '@/lib/record-links'
import Tooltip from '@/components/Tooltip'

export function CopyRecordLink({
  workspaceId,
  sentenceId,
  discussion = false,
  compact = false
}: {
  workspaceId: string
  sentenceId: string
  discussion?: boolean
  compact?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [fallbackUrl, setFallbackUrl] = useState('')
  const [copying, setCopying] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const label = discussion ? 'Copy discussion link' : 'Copy link'
  const copy = async () => {
    const url = new URL(recordPath(workspaceId, sentenceId, discussion), window.location.origin).href
    setCopying(true)
    setFallbackUrl('')
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
      setFallbackUrl(url)
    } finally {
      setCopying(false)
    }
  }
  return (
    <span className="relative inline-flex flex-col items-start gap-1">
      <Tooltip content={compact ? (copied ? 'Link copied' : label) : ''} delayDuration={300}>
        <button
          type="button"
          disabled={copying}
          onClick={copy}
          className={buttonClass('ghost', 'sm', compact ? 'min-h-9 min-w-9' : '')}
          title={copied ? 'Link copied' : label}
          aria-label={compact ? (copied ? 'Link copied' : label) : undefined}
        >
          {copied ? (
            <Check className="w-4 h-4 text-indigo-700" aria-hidden="true" />
          ) : (
            <LinkIcon className="w-4 h-4" aria-hidden="true" />
          )}
          {!compact && (copied ? 'Link copied' : label)}
        </button>
      </Tooltip>
      <span role="status" className="sr-only">
        {copied ? 'Link copied' : ''}
      </span>
      {fallbackUrl && (
        <label
          className={`text-xs text-red-700 whitespace-normal max-w-64 ${compact ? 'absolute right-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-3rem)] border border-gray-200 bg-white p-3 shadow-lg' : ''}`}
        >
          Could not copy. Select and copy this link:
          <input
            aria-label="Link to copy"
            readOnly
            value={fallbackUrl}
            onFocus={e => e.target.select()}
            className="mt-1 w-full border border-gray-500 p-2 text-gray-900 focus-visible:outline-indigo-600"
          />
        </label>
      )}
    </span>
  )
}
