'use client'

import { useId, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as Popover from '@radix-ui/react-popover'
import { useQuery } from '@tanstack/react-query'
import { ChevronsUpDown } from 'lucide-react'
import Modal from '@/components/Modal'
import type { WorkspaceInfo } from '@/components/WorkspaceProvider'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetch'
import { hasUnsavedChanges } from '@/lib/unsaved-changes'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'

type WorkspaceSummary = {
  id: string
  name: string
  status: 'active' | 'archived'
  role: 'admin' | 'supervisor' | 'labeller'
  authority: 'membership' | 'platform'
}

const roleText = (role: string, authority: string) => (authority === 'platform' ? `${role} (platform)` : role)

/**
 * The current workspace and the effective role in it, and a searchable list of
 * the other workspaces the user may enter (from /api/workspaces). Keyboard:
 * type to filter, arrows to move, Enter to switch, Escape to close.
 */
export default function WorkspaceSwitcher({
  workspace,
  collapsed
}: {
  workspace: WorkspaceInfo | null
  collapsed: boolean
}) {
  const id = useId()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [pending, setPending] = useState<WorkspaceSummary | null>(null)

  const workspaces = useQuery({
    queryKey: queryKeys.workspaces(),
    queryFn: ({ signal }) => fetchJson<{ workspaces: WorkspaceSummary[] }>('/api/workspaces', { signal }),
    enabled: open
  })

  const needle = query.trim().toLowerCase()
  const options = (workspaces.data?.workspaces ?? []).filter(w => !needle || w.name.toLowerCase().includes(needle))
  const active = Math.min(activeIndex, Math.max(options.length - 1, 0))

  const go = (target: WorkspaceSummary) => {
    setOpen(false)
    setQuery('')
    router.push(`/w/${target.id}/queue`)
  }
  const choose = (target: WorkspaceSummary) => {
    if (target.id === workspace?.id) {
      setOpen(false)
      return
    }
    // Leaving a record with chosen but unsubmitted labels asks first.
    if (hasUnsavedChanges()) {
      setOpen(false)
      setPending(target)
      return
    }
    go(target)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(Math.min(active + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(Math.max(active - 1, 0))
    } else if (event.key === 'Enter') {
      const option = options[active]
      if (option) {
        event.preventDefault()
        choose(option)
      }
    }
  }

  const label = workspace
    ? `Workspace: ${workspace.name}, ${roleText(workspace.role, workspace.authority)}`
    : 'Choose a workspace'

  return (
    <>
      <Popover.Root
        open={open}
        onOpenChange={next => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            title={collapsed ? label : undefined}
          >
            {collapsed ? (
              <>
                <span
                  className="w-5 h-5 flex items-center justify-center rounded bg-indigo-100 text-indigo-800 text-xs font-semibold"
                  aria-hidden="true"
                >
                  {workspace?.name.slice(0, 1).toUpperCase() ?? 'W'}
                </span>
                <span className="sr-only">{`${label}. Switch workspace`}</span>
              </>
            ) : (
              <>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-gray-900 truncate">
                    {workspace?.name ?? 'Choose a workspace'}
                  </span>
                  <span className="block text-xs text-gray-600 truncate">
                    {workspace ? roleText(workspace.role, workspace.authority) : 'Open a workspace'}
                    {workspace?.archived ? ' · archived' : ''}
                  </span>
                </span>
                <ChevronsUpDown className="w-4 h-4 text-gray-500 flex-shrink-0" aria-hidden="true" />
                <span className="sr-only">Switch workspace</span>
              </>
            )}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={4}
            className="z-50 w-72 rounded-lg border border-gray-200 bg-white shadow-lg"
          >
            <div className="p-2 border-b border-gray-100">
              <label htmlFor={`${id}-search`} className="sr-only">
                Find a workspace
              </label>
              <input
                id={`${id}-search`}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={`${id}-list`}
                aria-autocomplete="list"
                aria-activedescendant={options[active] ? `${id}-ws-${active}` : undefined}
                autoComplete="off"
                placeholder="Find a workspace"
                value={query}
                onChange={e => {
                  setQuery(e.target.value)
                  setActiveIndex(0)
                }}
                onKeyDown={onKeyDown}
                className="w-full px-2 py-1.5 text-sm border border-gray-500 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </div>
            <ul id={`${id}-list`} role="listbox" aria-label="Workspaces" className="max-h-72 overflow-y-auto py-1">
              {options.map((w, index) => (
                <li
                  key={w.id}
                  id={`${id}-ws-${index}`}
                  role="option"
                  aria-selected={w.id === workspace?.id}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => choose(w)}
                  className={`px-3 py-2 cursor-pointer flex items-center gap-2 ${
                    index === active ? 'bg-indigo-50' : ''
                  }`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-gray-900 truncate">{w.name}</span>
                    <span className="block text-xs text-gray-600">
                      {roleText(w.role, w.authority)}
                      {w.status === 'archived' ? ' · archived' : ''}
                    </span>
                  </span>
                  {w.id === workspace?.id && (
                    <span className="text-indigo-700" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {options.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-600" role="status">
                {workspaces.isPending
                  ? 'Loading…'
                  : workspaces.isError
                    ? 'Could not load workspaces.'
                    : 'No workspace matches.'}
              </p>
            )}
            <div className="border-t border-gray-100 p-1">
              {workspace?.role === 'admin' && (
                <Link
                  href={`/workspaces?edit=${workspace.id}`}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-sm text-indigo-700 hover:bg-gray-50"
                >
                  Workspace settings
                </Link>
              )}
              <Link
                href="/workspaces"
                onClick={() => setOpen(false)}
                className="block rounded px-3 py-2 text-sm text-indigo-700 hover:bg-gray-50"
              >
                All workspaces
              </Link>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {pending && (
        <Modal label="Leave with unsaved labels?" onClose={() => setPending(null)}>
          <div className={`${dialogPanelClass} p-6 w-[28rem] max-w-[90vw]`}>
            <h2 className="text-lg font-medium text-gray-900 mb-2">Leave with unsaved labels?</h2>
            <p className="text-sm text-gray-700 mb-6">
              The labels chosen on this record are not submitted yet. Switch to {pending.name} anyway?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPending(null)} className={buttonClass('secondary')}>
                Stay
              </button>
              <button
                onClick={() => {
                  const target = pending
                  setPending(null)
                  go(target)
                }}
                className={buttonClass('primary')}
              >
                Switch workspace
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
