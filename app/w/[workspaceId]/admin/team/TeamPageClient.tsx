'use client'

import { useCallback, useMemo, useState } from 'react'
import { useSession } from '@/lib/auth-client'
import { useWorkspaceInfo } from '@/components/WorkspaceProvider'
import PageHeader from '@/components/PageHeader'
import { ToastContainer, type Toast } from '@/components/Toast'
import CreateMemberModal from '@/components/team/CreateMemberModal'
import MemberDrawer from '@/components/team/MemberDrawer'
import MemberImportModal from '@/components/team/MemberImportModal'
import PendingInvitations, { type PendingInvitation } from '@/components/team/PendingInvitations'
import { formatRelativeTime } from '@/lib/utils'
import {
  filterMembers,
  nextSort,
  NO_FILTERS,
  sortMembers,
  type Sort,
  type SortKey,
  type TeamFilters,
  type TeamMember
} from '@/lib/team-table'
import { workspaceApi } from '@/lib/workspace/urls'

export type User = TeamMember
export type { PendingInvitation }

type Props = { initialUsers: User[]; initialInvitations: PendingInvitation[]; mailEnabled: boolean }

const select =
  'px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500'

const COLUMNS: Array<{ key: SortKey; label: string; title?: string }> = [
  { key: 'username', label: 'Username' },
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'role', label: 'Role' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'team', label: 'Team' },
  { key: 'assignments', label: 'Assigned' },
  {
    key: 'lastSeenAt',
    label: 'Last seen',
    title: 'Last time the app was open in this workspace (background refreshes do not count)'
  },
  {
    key: 'lastLogin',
    label: 'Last sign-in',
    title: 'Last time they typed their password; sessions last days, so this can be old for active people'
  }
]

/**
 * Members of this workspace: search, filters and sorting in the browser
 * (lib/team-table.ts), a drawer per member, adding and importing members, and
 * open invitations. With mail on, members can be invited by link.
 */
export default function TeamPageClient({ initialUsers, initialInvitations, mailEnabled }: Props) {
  const { data: session } = useSession()
  const workspace = useWorkspaceInfo()
  const [members, setMembers] = useState<User[]>(initialUsers)
  const [filters, setFilters] = useState<TeamFilters>(NO_FILTERS)
  const [sort, setSort] = useState<Sort>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [invitations, setInvitations] = useState<PendingInvitation[]>(initialInvitations)
  const [toasts, setToasts] = useState<Toast[]>([])

  const notify = useCallback((type: Toast['type'], message: string) => {
    setToasts(t => [...t, { id: `${Date.now()}-${Math.random()}`, type, message }])
  }, [])
  const closeToast = useCallback((id: string) => setToasts(t => t.filter(x => x.id !== id)), [])

  const reload = useCallback(async () => {
    const [res, invited] = await Promise.all([
      fetch(workspaceApi('/users?includeSuspended=true')),
      fetch(workspaceApi('/invitations'))
    ])
    if (res.ok) setMembers((await res.json()).users)
    else notify('error', 'Could not reload the members.')
    if (invited.ok) setInvitations((await invited.json()).invitations)
  }, [notify])

  const changed = async (message: string) => {
    setSelectedId(null)
    setAdding(false)
    setImporting(false)
    notify('success', message)
    await reload()
  }

  const shown = useMemo(() => sortMembers(filterMembers(members, filters), sort), [members, filters, sort])
  const supervisors = members.filter(m => m.status === 'active' && (m.role === 'admin' || m.role === 'supervisor'))
  const selected = members.find(m => m.id === selectedId) ?? null
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS)
  const setFilter = <K extends keyof TeamFilters>(key: K, value: TeamFilters[K]) =>
    setFilters(f => ({ ...f, [key]: value }))

  return (
    <div className="flex flex-col h-screen">
      <PageHeader title="Team Management" />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-48">
            <label htmlFor="team-search" className="sr-only">
              Search members
            </label>
            <input
              id="team-search"
              type="search"
              placeholder="Search username, name or email"
              value={filters.search}
              onChange={e => setFilter('search', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <label className="sr-only" htmlFor="team-role">
            Role
          </label>
          <select
            id="team-role"
            value={filters.role}
            onChange={e => setFilter('role', e.target.value as TeamFilters['role'])}
            className={select}
          >
            <option value="">All roles</option>
            <option value="admin">Admins</option>
            <option value="supervisor">Supervisors</option>
            <option value="labeller">Labellers</option>
          </select>
          <label className="sr-only" htmlFor="team-supervisor">
            Supervisor
          </label>
          <select
            id="team-supervisor"
            value={filters.supervisorId}
            onChange={e => setFilter('supervisorId', e.target.value)}
            className={select}
          >
            <option value="">Any supervisor</option>
            {supervisors.map(s => (
              <option key={s.id} value={s.id}>
                Reports to {s.name || s.username}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="team-status">
            Status
          </label>
          <select
            id="team-status"
            value={filters.status}
            onChange={e => setFilter('status', e.target.value as TeamFilters['status'])}
            className={select}
          >
            <option value="active">Active</option>
            <option value="must-reset">Must reset password</option>
            <option value="invited">Invitation pending</option>
            <option value="removed">Removed</option>
            <option value="">Everyone</option>
          </select>
          <label className="sr-only" htmlFor="team-activity">
            Activity
          </label>
          <select
            id="team-activity"
            value={filters.activity}
            onChange={e => setFilter('activity', e.target.value as TeamFilters['activity'])}
            className={select}
          >
            <option value="">Any activity</option>
            <option value="seen-7">Seen in the last 7 days</option>
            <option value="not-seen-7">Not seen for 7 days</option>
            <option value="not-seen-30">Not seen for 30 days</option>
            <option value="never">Never seen here</option>
          </select>
          {filtered && (
            <button
              type="button"
              onClick={() => setFilters(NO_FILTERS)}
              className="px-3 py-2 text-sm text-indigo-700 underline"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Import members
          </button>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Add member
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
          <p aria-live="polite">
            {shown.length} of {members.length} members
          </p>
          <p
            title={
              mailEnabled
                ? 'Members can be invited by email and sent password links'
                : 'Email is not configured: hand over temporary passwords yourself'
            }
          >
            Email:{' '}
            <span className={mailEnabled ? 'text-indigo-700 font-medium' : 'text-gray-500 font-medium'}>
              {mailEnabled ? 'on' : 'off'}
            </span>
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {COLUMNS.map(column => {
                  const active = sort?.key === column.key
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      title={column.title}
                      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap"
                    >
                      <button
                        type="button"
                        onClick={() => setSort(s => nextSort(s, column.key))}
                        className="uppercase hover:text-gray-800"
                      >
                        {column.label}
                        {active ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                      </button>
                    </th>
                  )
                })}
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-900">
              {shown.map(m => (
                <tr key={m.id} className={`hover:bg-gray-50 ${m.status === 'suspended' ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3">
                    {m.username}
                    {m.status === 'suspended' && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">removed</span>
                    )}
                    {m.invitationPending && m.status === 'active' && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 text-xs">invited</span>
                    )}
                    {m.mustResetPassword && m.status === 'active' && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-xs">must reset</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{m.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{m.email}</td>
                  <td className="px-4 py-3 capitalize">{m.role}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {m.supervisor ? m.supervisor.name || m.supervisor.email : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{m.labellers.length || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{m._count.assignedSentences}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap" title={m.lastSeenAt ?? undefined}>
                    {m.lastSeenAt ? formatRelativeTime(m.lastSeenAt) : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap" title={m.lastLogin ?? undefined}>
                    {m.lastLogin ? formatRelativeTime(m.lastLogin) : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedId(m.id)}
                      className="text-indigo-600 hover:text-indigo-700"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-4 py-8 text-center text-gray-500">
                    No members match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <PendingInvitations
          invitations={invitations}
          mailEnabled={mailEnabled}
          onChanged={changed}
          onError={message => notify('error', message)}
        />
      </div>

      {adding && (
        <CreateMemberModal
          supervisors={supervisors}
          canAddExisting={workspace?.authority === 'platform'}
          mailEnabled={mailEnabled}
          onClose={() => setAdding(false)}
          onCreated={changed}
        />
      )}
      {importing && (
        <MemberImportModal mailEnabled={mailEnabled} onClose={() => setImporting(false)} onImported={changed} />
      )}
      {selected && (
        <MemberDrawer
          key={selected.id}
          member={selected}
          supervisors={supervisors}
          isSelf={selected.id === session?.user?.id}
          mailEnabled={mailEnabled}
          onClose={() => setSelectedId(null)}
          onChanged={changed}
        />
      )}
      <ToastContainer toasts={toasts} onClose={closeToast} />
    </div>
  )
}
