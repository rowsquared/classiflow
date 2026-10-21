'use client'

import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'

export type ComboboxOption = {
  value: string
  label: string
  /** Extra text after the label (a level, a role, a count). */
  hint?: string
}

type ComboboxProps = {
  /** Visible label; also the accessible name. */
  label: string
  /** Hide the label visually (it still names the input). */
  hideLabel?: boolean
  labelClassName?: string
  options: ComboboxOption[]
  value: string | null
  onChange: (value: string | null, option: ComboboxOption | null) => void
  /** Text shown for the selected value when it is not among the current options. */
  selectedLabel?: string
  /**
   * Called with what the user types. Without it the options are filtered here
   * (label and value, case-insensitive); with it the caller searches (server).
   */
  onQueryChange?: (query: string) => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  emptyText?: string
  className?: string
  inputClassName?: string
  /** Rendered after the input, e.g. a status line. */
  children?: ReactNode
}

/**
 * Searchable single choice following the WAI-ARIA combobox pattern: focus
 * stays in the text input, arrow keys move through the list
 * (aria-activedescendant), Enter chooses, Escape closes. The list is a Radix
 * popover anchored to the input, so it is positioned and dismissed like the
 * app's other floating elements.
 */
export default function Combobox({
  label,
  hideLabel = false,
  labelClassName = 'block text-xs text-gray-600 mb-1',
  options,
  value,
  onChange,
  selectedLabel,
  onQueryChange,
  placeholder,
  disabled = false,
  loading = false,
  emptyText = 'No matches',
  className = '',
  inputClassName = '',
  children
}: ComboboxProps) {
  const id = useId()
  const listId = `${id}-list`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const normalized = query.trim().toLowerCase()
  const visible =
    onQueryChange || !normalized
      ? options
      : options.filter(o => o.label.toLowerCase().includes(normalized) || o.value.toLowerCase().includes(normalized))
  const active = Math.min(activeIndex, Math.max(visible.length - 1, 0))
  const selected = options.find(o => o.value === value) ?? null
  const display = selected?.label ?? selectedLabel ?? ''

  const updateQuery = (next: string) => {
    setQuery(next)
    setActiveIndex(0)
    onQueryChange?.(next)
  }
  const close = () => {
    setOpen(false)
    if (query) updateQuery('')
  }
  const choose = (option: ComboboxOption) => {
    onChange(option.value, option)
    close()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!open) setOpen(true)
        else setActiveIndex(Math.min(active + 1, visible.length - 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex(Math.max(active - 1, 0))
        break
      case 'Home':
        if (open) {
          event.preventDefault()
          setActiveIndex(0)
        }
        break
      case 'End':
        if (open) {
          event.preventDefault()
          setActiveIndex(Math.max(visible.length - 1, 0))
        }
        break
      case 'Enter': {
        const option = visible[active]
        if (open && option) {
          event.preventDefault()
          choose(option)
        }
        break
      }
      case 'Escape':
        if (open) {
          // Close the list only, not a dialog the combobox sits in.
          event.preventDefault()
          event.stopPropagation()
          close()
        }
        break
      case 'Tab':
        if (open) close()
        break
    }
  }

  const activeOption = open ? visible[active] : undefined

  return (
    <div className={className}>
      <label htmlFor={`${id}-input`} className={hideLabel ? 'sr-only' : labelClassName}>
        {label}
      </label>
      <Popover.Root open={open && !disabled} onOpenChange={next => (next ? setOpen(true) : close())}>
        <Popover.Anchor asChild>
          <div className="relative">
            <input
              id={`${id}-input`}
              type="text"
              role="combobox"
              aria-expanded={open && !disabled}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeOption ? `${id}-opt-${active}` : undefined}
              autoComplete="off"
              disabled={disabled}
              placeholder={display || placeholder}
              value={open ? query : display}
              onChange={e => {
                setOpen(true)
                updateQuery(e.target.value)
              }}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onKeyDown={onKeyDown}
              className={`w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${
                value ? 'pr-7' : ''
              } ${inputClassName}`}
            />
            {value && !disabled && (
              <button
                type="button"
                onClick={() => onChange(null, null)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                aria-label={`Clear ${label}`}
              >
                ×
              </button>
            )}
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            onOpenAutoFocus={e => e.preventDefault()}
            onCloseAutoFocus={e => e.preventDefault()}
            onInteractOutside={e => {
              // Clicks on the input itself keep the list open.
              if ((e.target as Element | null)?.closest?.(`[id="${id}-input"]`)) e.preventDefault()
            }}
            className="z-50 max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg"
            style={{ width: 'var(--radix-popper-anchor-width)', minWidth: '12rem' }}
          >
            <ul id={listId} role="listbox" aria-label={label}>
              {visible.map((option, index) => (
                <li
                  key={option.value}
                  id={`${id}-opt-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  onMouseDown={e => e.preventDefault()}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                  className={`px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${
                    index === active ? 'bg-indigo-50 text-indigo-900' : 'text-gray-800'
                  }`}
                >
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.hint && <span className="text-xs text-gray-600">{option.hint}</span>}
                  {option.value === value && <span aria-hidden="true">✓</span>}
                </li>
              ))}
            </ul>
            {visible.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-600">{loading ? 'Loading…' : emptyText}</p>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {children}
    </div>
  )
}
