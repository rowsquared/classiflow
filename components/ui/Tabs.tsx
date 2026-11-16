'use client'

import { useId, type KeyboardEvent, type ReactNode } from 'react'

export type Tab<T extends string> = { id: T; label: string }

/**
 * ARIA tabs (tablist, roving focus with the arrow keys, Home/End). The caller
 * keeps the selected tab; only the selected panel is rendered.
 */
export default function Tabs<T extends string>({
  label,
  tabs,
  selected,
  onSelect,
  children
}: {
  label: string
  tabs: Tab<T>[]
  selected: T
  onSelect: (id: T) => void
  children: ReactNode
}) {
  const base = useId()
  const tabId = (id: T) => `${base}-tab-${id}`
  const panelId = `${base}-panel`
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex(t => t.id === selected)
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1
    const target = tabs[next]
    if (!target) return
    event.preventDefault()
    onSelect(target.id)
    document.getElementById(tabId(target.id))?.focus()
  }
  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 border-b border-gray-200" onKeyDown={move}>
        {tabs.map(tab => {
          const active = tab.id === selected
          return (
            <button
              key={tab.id}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${
                active ? 'border-indigo-600 text-gray-900' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(selected)} className="pt-5">
        {children}
      </div>
    </div>
  )
}
