'use client'

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Dialog behaviour for an element that is mounted while the dialog is open:
 * moves focus into it, keeps Tab inside it, closes on Escape and gives focus
 * back to whatever had it before. Spread the returned props on the element.
 */
export function useDialog(onClose: () => void, label: string) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () =>
      Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        el => el.getClientRects().length > 0
      )
    const autofocus = ref.current?.querySelector<HTMLElement>('[autofocus]')
    ;(autofocus ?? focusables()[0] ?? ref.current)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      const first = items[0]
      const last = items.at(-1)
      if (!first || !last) {
        event.preventDefault()
        return
      }
      const active = document.activeElement
      const outside = !ref.current?.contains(active)
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault()
        first.focus()
      }
    }
    // Capture phase, so page-level keyboard shortcuts do not see Escape/Tab first.
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus()
    }
  }, [])

  return {
    ref: ref as RefObject<HTMLDivElement>,
    role: 'dialog' as const,
    'aria-modal': true as const,
    'aria-label': label,
    tabIndex: -1
  }
}

type ModalProps = {
  /** Accessible name, usually the dialog's heading. */
  label: string
  onClose: () => void
  /** Classes of the full-screen overlay, which is also the dialog element. Defaults to a centred dialog. */
  className?: string
  /** Clicking the overlay outside the content closes the dialog. */
  closeOnOverlayClick?: boolean
  children: ReactNode
}

/** The brand's one scrim: flat 50% black, content centred. */
export const DIALOG_OVERLAY = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'

/** Full-screen modal: overlay + dialog behaviour from useDialog. */
export default function Modal({
  label,
  onClose,
  className = DIALOG_OVERLAY,
  closeOnOverlayClick = false,
  children
}: ModalProps) {
  const dialog = useDialog(onClose, label)
  return (
    <div
      {...dialog}
      className={`${className} focus:outline-none`}
      onClick={
        closeOnOverlayClick
          ? event => {
              if (event.target === event.currentTarget) onClose()
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}
