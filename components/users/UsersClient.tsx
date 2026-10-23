'use client'
import { useState } from 'react'
import { useQueryStates } from 'nuqs'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import * as Popover from '@radix-ui/react-popover'
import { usersParsers } from '@/lib/users-url'
import { fetchJson } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useLastSuccessful } from '@/lib/query/use-last-successful'
import { buttonClass, panelClass, badgeClass, dialogPanelClass } from '@/components/ui/styles'
import Combobox from '@/components/ui/Combobox'
import Modal from '@/components/Modal'
import MemberImportModal from '@/components/team/MemberImportModal'
import PendingInvitations, { type PendingInvitation } from '@/components/team/PendingInvitations'
import UserEditor from './UserEditor'
import AddUser from './AddUser'
import { controlClass, type DirectoryPage, type DirectoryUser, type Workspace } from './types'
import { formatRelativeTime } from '@/lib/utils'

const when = (date: string | null) => (date ? formatRelativeTime(date) : 'Never')
export default function UsersClient({
  currentUserId,
  platform,
  workspaces,
  mailEnabled,
  initialData,
  initialParams
}: {
  currentUserId: string
  platform: boolean
  workspaces: Workspace[]
  mailEnabled: boolean
  initialData: DirectoryPage
  initialParams: string
}) {
  const [view, setView] = useQueryStates(usersParsers)
  const q = useDebouncedValue(view.q.trim(), 300)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importWorkspace, setImportWorkspace] = useState('')
  const [message, setMessage] = useState('')
  const cache = useQueryClient()
  const params = new URLSearchParams(
    Object.entries({ ...view, q })
      .filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => [k, String(v)])
  )
  const selected = workspaces.find(w => w.id === view.workspace)
  const directory = useQuery({
    queryKey: queryKeys.directoryPage(params.toString()),
    queryFn: ({ signal }) => fetchJson<DirectoryPage>(`/api/user-directory?${params}`, { signal }),
    initialData: JSON.stringify(view) === initialParams && q === view.q ? initialData : undefined,
    placeholderData: (previous, previousQuery) =>
      new URLSearchParams(String(previousQuery?.queryKey[2] ?? '')).get('workspace') === (view.workspace || null)
        ? keepPreviousData(previous)
        : undefined
  })
  const data = useLastSuccessful(directory.data, view.workspace)
  const invitations = useQuery({
    queryKey: queryKeys.invitations(selected?.id ?? ''),
    enabled: !!selected,
    queryFn: ({ signal }) =>
      fetchJson<{ invitations: PendingInvitation[] }>(`/api/workspaces/${selected!.id}/invitations`, { signal })
  })
  const supervisors = useQuery({
    queryKey: queryKeys.members(selected?.id ?? ''),
    enabled: !!selected,
    queryFn: ({ signal }) =>
      fetchJson<{ users: Array<{ id: string; name: string; role: string; status: string }> }>(
        `/api/workspaces/${selected!.id}/users?includeSuspended=true`,
        { signal }
      )
  })
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.directory() }),
      ...(selected ? [cache.invalidateQueries({ queryKey: queryKeys.workspace(selected.id) })] : [])
    ])
  }
  const change = (next: Partial<typeof view>) => void setView({ ...next, page: 1 }, { history: 'push' })
  const sort = (key: typeof view.sort, label: string) => (
    <button
      type="button"
      onClick={() => change({ sort: key, direction: view.sort === key && view.direction === 'asc' ? 'desc' : 'asc' })}
    >
      {label}
      {view.sort === key ? (view.direction === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  )
  const activeWorkspace = selected?.status === 'active'
  return (
    <div className="px-4 py-6 sm:px-8 max-w-[100rem] mx-auto space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Users</h1>
          <p className="text-sm text-gray-600 mt-1">
            People and their access to workspaces. Roles are set per workspace.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className={buttonClass('secondary')}
            disabled={!!selected && !activeWorkspace}
            onClick={() => {
              setImportWorkspace(selected?.id ?? '')
              setImporting(true)
            }}
          >
            Import CSV
          </button>
          {selected && (
            <a
              className={buttonClass('secondary')}
              href={`/api/workspaces/${selected.id}/users/export`}
              title="Exports every member of this workspace, including removed members"
            >
              Export CSV
            </a>
          )}
          {!selected && (
            <a className={buttonClass('secondary')} href={`/api/user-directory/export?${params}`}>
              Export CSV
            </a>
          )}
          <button
            className={buttonClass('primary')}
            disabled={(!!selected && !activeWorkspace) || (!platform && workspaces.every(w => w.status !== 'active'))}
            onClick={() => setAdding(true)}
          >
            Add user
          </button>
        </div>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-48 text-sm text-gray-700">
          Search name or email
          <input
            className={controlClass}
            type="search"
            value={view.q}
            onChange={e => void setView({ q: e.target.value, page: 1 })}
          />
        </label>
        <Combobox
          label="Workspace"
          className="w-56"
          value={view.workspace || null}
          options={[
            { value: '', label: 'Any managed workspace' },
            ...(platform ? [{ value: 'none', label: 'No workspace access' }] : []),
            ...workspaces.map(w => ({
              value: w.id,
              label: w.name,
              hint: w.status === 'archived' ? 'Archived' : undefined
            }))
          ]}
          onChange={id =>
            change({
              workspace: id ?? '',
              role: null,
              supervisor: null,
              activity: null,
              sort: 'name',
              access: 'active'
            })
          }
          placeholder="Any managed workspace"
        />
        {selected && (
          <>
            <label className="text-sm text-gray-700">
              Workspace role
              <select
                className={controlClass}
                value={view.role ?? ''}
                onChange={e => change({ role: (e.target.value as typeof view.role) || null })}
              >
                <option value="">Any role</option>
                <option value="admin">Workspace admin</option>
                <option value="supervisor">Supervisor</option>
                <option value="labeller">Labeller</option>
              </select>
            </label>
            <label className="text-sm text-gray-700">
              Access
              <select
                className={controlClass}
                value={view.access}
                onChange={e => change({ access: e.target.value as typeof view.access })}
              >
                <option value="active">Active</option>
                <option value="removed">Removed</option>
                <option value="all">Everyone</option>
              </select>
            </label>
            <Combobox
              className="w-48"
              label="Supervisor"
              value={view.supervisor}
              onChange={id => change({ supervisor: id })}
              options={(supervisors.data?.users ?? [])
                .filter(u => u.role !== 'labeller' && u.status === 'active')
                .map(u => ({ value: u.id, label: u.name }))}
              placeholder="Any supervisor"
            />
            <label className="text-sm text-gray-700">
              Activity
              <select
                className={controlClass}
                value={view.activity ?? ''}
                onChange={e => change({ activity: (e.target.value as typeof view.activity) || null })}
              >
                <option value="">Any activity</option>
                <option value="seen-7">Seen in the last 7 days</option>
                <option value="not-seen-7">Not seen for 7 days</option>
                <option value="not-seen-30">Not seen for 30 days</option>
                <option value="never">Never seen here</option>
              </select>
            </label>
          </>
        )}
        <label className="text-sm text-gray-700">
          Account
          <select
            className={controlClass}
            value={view.state ?? ''}
            onChange={e => change({ state: (e.target.value as typeof view.state) || null })}
          >
            <option value="">Enabled and disabled</option>
            <option value="active">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Password setup
          <select
            className={controlClass}
            value={view.setup ?? ''}
            onChange={e => change({ setup: (e.target.value as typeof view.setup) || null })}
          >
            <option value="">Any setup state</option>
            <option value="password">Password change required</option>
            <option value="invited">Setup link pending</option>
          </select>
        </label>
        <button
          className={buttonClass('secondary')}
          onClick={() =>
            void setView(
              {
                q: '',
                workspace: !platform && workspaces.length === 1 ? workspaces[0]!.id : '',
                role: null,
                state: null,
                setup: null,
                supervisor: null,
                activity: null,
                access: 'active',
                page: 1,
                sort: 'name',
                direction: 'asc'
              },
              { history: 'push' }
            )
          }
        >
          Clear
        </button>
      </div>
      {message && (
        <p role="status" className="text-sm text-gray-700">
          {message}
        </p>
      )}
      {directory.isError && (
        <p role="alert" className="text-sm text-red-700">
          Could not refresh users.{' '}
          <button className="underline" onClick={() => void directory.refetch()}>
            Try again
          </button>
        </p>
      )}
      {selected?.status === 'archived' && (
        <p role="status" className="text-sm text-amber-900">
          This workspace is archived and read-only. Reopen it in Workspace settings to change access.
        </p>
      )}
      <p className="text-sm text-gray-600" role="status">
        {data?.total ?? 0} of {data?.totalAvailable ?? 0} {selected ? 'members' : 'users'}
        {directory.isFetching ? ' · Loading…' : ''}
      </p>
      <div className={`${panelClass} overflow-x-auto`} aria-busy={directory.isFetching}>
        <table className={`w-full text-sm text-left ${directory.isPlaceholderData ? 'opacity-60' : ''}`}>
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th
                className="p-3"
                aria-sort={view.sort === 'name' ? (view.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {sort('name', 'Name')}
              </th>
              <th
                className="p-3"
                aria-sort={view.sort === 'email' ? (view.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {sort('email', 'Email')}
              </th>
              {selected ? (
                <>
                  <th
                    className="p-3"
                    aria-sort={view.sort === 'role' ? (view.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {sort('role', 'Workspace role')}
                  </th>
                  <th
                    className="p-3"
                    aria-sort={
                      view.sort === 'supervisor' ? (view.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    {sort('supervisor', 'Supervisor')}
                  </th>
                  <th
                    className="p-3"
                    aria-sort={view.sort === 'team' ? (view.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {sort('team', 'Team')}
                  </th>
                  <th
                    className="p-3"
                    aria-sort={
                      view.sort === 'assigned' ? (view.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    {sort('assigned', 'Assigned')}
                  </th>
                  <th
                    className="p-3"
                    aria-sort={
                      view.sort === 'lastSeen' ? (view.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    {sort('lastSeen', 'Last seen')}
                  </th>
                </>
              ) : (
                <>
                  <th className="p-3">Workspaces</th>
                  <th
                    className="p-3"
                    aria-sort={
                      view.sort === 'lastLogin' ? (view.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    {sort('lastLogin', 'Last sign-in')}
                  </th>
                </>
              )}
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 text-gray-900">
            {data?.users.map(user => {
              const m = user.memberships.find(m => m.workspace.id === selected?.id)
              return (
                <tr key={user.id} className={user.banned ? 'text-gray-600 bg-gray-50' : ''}>
                  <td className="p-3">
                    {user.name}
                    {user.banned && <span className={`${badgeClass()} ml-2`}>Disabled</span>}
                    {user.mustResetPassword && (
                      <span className="block text-xs text-gray-600">Password change required</span>
                    )}
                    {user.invitedAt && !user.invitationAcceptedAt && (
                      <span className="block text-xs text-gray-600">Setup link pending</span>
                    )}
                  </td>
                  <td className="p-3">{user.email}</td>
                  {selected ? (
                    <>
                      <td className="p-3">
                        {m?.role}
                        {m?.status === 'suspended' ? ' · removed' : ''}
                        {user.role === 'admin' && <span className="block text-xs">Platform admin: full access</span>}
                      </td>
                      <td className="p-3">{m?.supervisor?.user.name ?? '—'}</td>
                      <td className="p-3">{m?._count.reports ?? 0}</td>
                      <td className="p-3">{user.assigned ?? 0}</td>
                      <td className="p-3">{when(m?.lastSeenAt ?? null)}</td>
                    </>
                  ) : (
                    <>
                      <td className="p-3">
                        <AccessChips user={user} platform={platform} />
                      </td>
                      <td className="p-3">{when(user.lastLogin)}</td>
                    </>
                  )}
                  <td className="p-3">
                    <button className="text-indigo-700 underline" onClick={() => setEditing(user.id)}>
                      Edit<span className="sr-only"> {user.name}</span>
                    </button>
                  </td>
                </tr>
              )
            })}
            {data?.users.length === 0 && (
              <tr>
                <td colSpan={selected ? 9 : 5} className="p-6 text-gray-600">
                  No users match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <nav aria-label="User pages" className="flex items-center justify-end gap-3 text-sm">
        <button
          className={buttonClass('secondary')}
          disabled={view.page <= 1}
          onClick={() => void setView({ page: view.page - 1 }, { history: 'push' })}
        >
          Previous
        </button>
        <span>
          Page {view.page} of {Math.max(1, Math.ceil((data?.total ?? 0) / 50))}
        </span>
        <button
          className={buttonClass('secondary')}
          disabled={view.page * 50 >= (data?.total ?? 0)}
          onClick={() => void setView({ page: view.page + 1 }, { history: 'push' })}
        >
          Next
        </button>
      </nav>
      {selected && (
        <details>
          <summary className="cursor-pointer text-sm text-gray-700">
            Pending invitations ({invitations.data?.invitations.length ?? 0})
          </summary>
          {invitations.isError && <p role="alert">Could not load invitations.</p>}
          <PendingInvitations
            workspaceId={selected.id}
            invitations={invitations.data?.invitations ?? []}
            readOnly={!activeWorkspace}
            mailEnabled={mailEnabled && !!activeWorkspace}
            onChanged={msg => {
              setMessage(msg)
              void refresh()
            }}
            onError={setMessage}
          />
        </details>
      )}
      {editing && (
        <UserEditor
          userId={editing}
          currentUserId={currentUserId}
          platform={platform}
          workspaces={workspaces}
          mailEnabled={mailEnabled}
          onClose={() => setEditing(null)}
          onChanged={refresh}
        />
      )}
      {adding && (
        <AddUser
          platform={platform}
          workspaces={workspaces}
          defaultWorkspace={selected?.id}
          mailEnabled={mailEnabled}
          onClose={() => setAdding(false)}
          onChanged={refresh}
        />
      )}
      {importing &&
        (importWorkspace ? (
          <MemberImportModal
            workspaceId={importWorkspace}
            mailEnabled={mailEnabled}
            onClose={() => setImporting(false)}
            onImported={msg => {
              setImporting(false)
              setMessage(msg)
              void refresh()
            }}
          />
        ) : (
          <Modal label="Import users" onClose={() => setImporting(false)}>
            <div className={`${dialogPanelClass} p-6 max-w-md w-full space-y-4`}>
              <h2 className="text-lg font-medium">Import users</h2>
              <Combobox
                label="Workspace for import"
                value={null}
                options={workspaces.filter(w => w.status === 'active').map(w => ({ value: w.id, label: w.name }))}
                onChange={id => setImportWorkspace(id ?? '')}
              />
              <button className={buttonClass('secondary')} onClick={() => setImporting(false)}>
                Cancel
              </button>
            </div>
          </Modal>
        ))}
    </div>
  )
}
function AccessChips({ user, platform }: { user: DirectoryUser; platform: boolean }) {
  if (user.role === 'admin' && platform) return <span className={badgeClass()}>All workspaces · platform admin</span>
  const memberships = user.memberships.filter(m => m.status === 'active')
  const chip = (m: DirectoryUser['memberships'][number]) => (
    <span key={m.id} className={`${badgeClass()} ${m.workspace.status === 'archived' ? 'text-gray-600' : ''}`}>
      {m.workspace.name} · {m.role}
      {m.workspace.status === 'archived' ? ' · archived' : ''}
    </span>
  )
  return (
    <div className="flex flex-wrap gap-1">
      {memberships.slice(0, 3).map(chip)}
      {!memberships.length && <span>No active access{platform ? '' : ' in managed workspaces'}</span>}
      {memberships.length > 3 && (
        <Popover.Root>
          <Popover.Trigger
            className="text-indigo-700 underline"
            aria-label={`Show ${memberships.length - 3} more workspaces`}
          >
            +{memberships.length - 3}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="z-50 bg-white border border-gray-200 shadow-lg p-3 max-w-sm flex flex-wrap gap-1">
              {memberships.slice(3).map(chip)}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  )
}
