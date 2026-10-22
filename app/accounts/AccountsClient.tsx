'use client'

import { useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'
import WorkspaceAccess from '@/components/team/WorkspaceAccess'
import Modal from '@/components/Modal'
import QueryProvider from '@/components/QueryProvider'
import { fetchJson, HttpError } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { USER_ROLE_FILTERS, USER_STATE_FILTERS, USERS_PAGE_SIZE } from '@/lib/contracts/users'
import { buttonClass, dialogPanelClass, panelClass } from '@/components/ui/styles'

type Account = {
  id: string
  username: string
  email: string
  name: string
  platformRole: 'admin' | 'user'
  banned: boolean | null
  mustResetPassword: boolean
  lastLogin: string | null
  memberships: Array<{ role: string; status: string; workspace: { id: string; name: string } }>
}
type Page = { users: Account[]; total: number; page: number; pageSize: number }

const input =
  'w-full px-3 py-2 border border-gray-500 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-gray-900'

// The directory's view lives in the URL with the API's parameter names
// (lib/contracts/users.ts); the server filters and pages.
const directoryParsers = {
  q: parseAsString.withDefault(''),
  workspace: parseAsString.withDefault(''),
  role: parseAsStringLiteral(USER_ROLE_FILTERS),
  state: parseAsStringLiteral(USER_STATE_FILTERS),
  page: parseAsInteger.withDefault(1)
}

const ROLE_LABEL: Record<(typeof USER_ROLE_FILTERS)[number], string> = {
  platform_admin: 'Platform admin',
  admin: 'Workspace admin',
  supervisor: 'Supervisor',
  labeller: 'Labeller'
}
const STATE_LABEL: Record<(typeof USER_STATE_FILTERS)[number], string> = {
  active: 'Enabled',
  disabled: 'Disabled',
  must_reset: 'Must change password'
}

// /team is outside any workspace, so it has its own query cache and URL adapter.
export default function AccountsClient({ currentUserId }: { currentUserId: string }) {
  return (
    <NuqsAdapter>
      <QueryProvider>
        <Accounts currentUserId={currentUserId} />
      </QueryProvider>
    </NuqsAdapter>
  )
}

function Accounts({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [view, setView] = useQueryStates(directoryParsers)
  const q = useDebouncedValue(view.q.trim(), 300)
  const params = new URLSearchParams(
    Object.entries({ q, workspace: view.workspace, role: view.role ?? '', state: view.state ?? '' }).filter(
      ([, value]) => value
    )
  )
  params.set('page', String(view.page))
  params.set('pageSize', String(USERS_PAGE_SIZE))

  const {
    data,
    isPending: loading,
    isFetching,
    isError
  } = useQuery({
    queryKey: queryKeys.accountsPage(params.toString()),
    queryFn: ({ signal }) => fetchJson<Page>(`/api/users?${params}`, { signal }),
    placeholderData: keepPreviousData
  })
  const workspaces = useQuery({
    queryKey: queryKeys.workspaces(),
    queryFn: ({ signal }) =>
      fetchJson<{ workspaces: Array<{ id: string; name: string }> }>('/api/workspaces', { signal })
  })
  const editing = useQuery({
    queryKey: queryKeys.account(editingId ?? ''),
    queryFn: ({ signal }) => fetchJson<{ user: Account }>(`/api/users/${editingId}`, { signal }),
    enabled: !!editingId
  })
  const accounts = data?.users ?? []
  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? USERS_PAGE_SIZE
  const first = total === 0 ? 0 : (view.page - 1) * pageSize + 1
  const last = Math.min(total, view.page * pageSize)
  const filtered = !!(view.q || view.workspace || view.role || view.state)

  const error = isError ? 'Could not load the accounts.' : null
  const load = () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
  // A filter change starts again at the first page.
  const filter = (change: Partial<typeof view>) => setView({ ...change, page: null }, { history: 'push' })

  const send = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new HttpError(res.status, { ...data, error: data.error || 'The change was refused' })
    await load()
    return data
  }

  return (
    <div className="min-h-screen bg-gray-50 overflow-auto">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Team</h1>
            <p className="text-sm text-gray-600">
              Global users. Each person has one account and a separate role in each workspace.
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/workspaces"
              className="px-4 py-2 border border-gray-500 rounded-lg text-gray-700 hover:bg-white"
            >
              Workspaces
            </Link>
            <button onClick={() => setCreating(true)} className={buttonClass('primary')}>
              Add user
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-4 p-3 rounded bg-red-50 text-red-700 text-sm border border-red-200">
            {error}
          </div>
        )}

        <nav aria-label="Team views" className="flex gap-4 mb-6">
          <span aria-current="page">Users</span>
          <Link href="/workspaces">Workspaces</Link>
        </nav>
        <div className="flex flex-wrap gap-3 mb-4">
          <label className="flex-1 min-w-48 text-sm text-gray-700">
            Search users
            <input
              className={input}
              value={view.q}
              onChange={e => setView({ q: e.target.value || null, page: null })}
              type="search"
            />
          </label>
          <label className="text-sm text-gray-700">
            Workspace access
            <select className={input} value={view.workspace} onChange={e => filter({ workspace: e.target.value })}>
              <option value="">All users</option>
              <option value="none">No workspace access</option>
              {workspaces.data?.workspaces.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Role
            <select
              className={input}
              value={view.role ?? ''}
              onChange={e => filter({ role: (e.target.value || null) as typeof view.role })}
            >
              <option value="">Any role</option>
              {USER_ROLE_FILTERS.map(role => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Account
            <select
              className={input}
              value={view.state ?? ''}
              onChange={e => filter({ state: (e.target.value || null) as typeof view.state })}
            >
              <option value="">Any state</option>
              {USER_STATE_FILTERS.map(state => (
                <option key={state} value={state}>
                  {STATE_LABEL[state]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading && <p role="status">Loading users…</p>}
        <div className={`${panelClass} overflow-x-auto ${isFetching && !loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-left text-sm font-medium text-gray-600">
              <tr>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Platform role</th>
                <th className="px-4 py-3">Workspaces</th>
                <th className="px-4 py-3">Last sign-in</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-900">
              {accounts.map(a => (
                <tr key={a.id} className={a.banned ? 'opacity-60' : ''}>
                  <td className="px-4 py-3">
                    {a.username}
                    {a.banned ? ' (disabled)' : ''}
                  </td>
                  <td className="px-4 py-3">{a.name}</td>
                  <td className="px-4 py-3 text-gray-600">{a.email}</td>
                  <td className="px-4 py-3">{a.platformRole === 'admin' ? 'Platform admin' : 'User'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {a.platformRole === 'admin' && (
                      <span className="block">All workspaces (platform administrator)</span>
                    )}
                    {a.memberships.length === 0
                      ? '—'
                      : a.memberships.map(m => (
                          <span key={m.workspace.id} className="block">
                            {m.workspace.name}: {m.role}
                            {m.status === 'suspended' ? ' (removed)' : ''}
                          </span>
                        ))}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {a.lastLogin ? new Date(a.lastLogin).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditingId(a.id)} className="text-indigo-700 hover:text-indigo-800">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && accounts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-600">
                    {filtered ? 'No users match these filters.' : 'No users yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm text-gray-700">
            <p>
              {first}–{last} of {total} users
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                disabled={view.page <= 1}
                onClick={() => setView({ page: view.page - 1 }, { history: 'push' })}
              >
                Previous
              </button>
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                disabled={last >= total}
                onClick={() => setView({ page: view.page + 1 }, { history: 'push' })}
              >
                Next
              </button>
            </div>
          </nav>
        )}
      </div>

      {creating && (
        <CreateAccount
          onClose={() => setCreating(false)}
          onSave={async body => {
            try {
              const result = await send('/api/users', 'POST', body)
              setCreating(false)
              setEditingId(result.user.id)
            } catch (caught) {
              // The email belongs to an account already: open that account instead.
              const existing =
                caught instanceof HttpError ? (caught.body as { existingUserId?: string }).existingUserId : undefined
              if (!existing) throw caught
              setCreating(false)
              setEditingId(existing)
            }
          }}
        />
      )}
      {editingId && editing.isError && (
        <Modal label="User" onClose={() => setEditingId(null)}>
          <div role="alert" className={`${dialogPanelClass} p-6 max-w-md w-full mx-4 text-sm text-red-700`}>
            Could not load this user.
          </div>
        </Modal>
      )}
      {editing.data?.user.id === editingId && editing.data && (
        <EditAccount
          key={editing.data.user.id}
          account={editing.data.user}
          onMembershipChanged={load}
          isSelf={editing.data.user.id === currentUserId}
          onClose={() => setEditingId(null)}
          onSave={async body => {
            await send(`/api/users/${editingId}`, 'PUT', body)
            setEditingId(null)
          }}
          onDelete={async () => {
            await send(`/api/users/${editingId}`, 'DELETE')
            setEditingId(null)
          }}
        />
      )}
    </div>
  )
}

function useSubmit(action: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change was refused')
    } finally {
      setBusy(false)
    }
  }
  return { error, busy, run }
}

function CreateAccount({ onClose, onSave }: { onClose: () => void; onSave: (body: unknown) => Promise<void> }) {
  const [form, setForm] = useState({ email: '', name: '', platformRole: 'user', tempPassword: '' })
  const { error, busy, run } = useSubmit(() => onSave(form))
  const field = (key: keyof typeof form, label: string, type = 'text') => (
    <div>
      <label htmlFor={`new-${key}`} className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        id={`new-${key}`}
        type={type}
        required
        value={form[key]}
        className={input}
        onChange={e => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  )
  return (
    <Modal label="Add user" onClose={onClose}>
      <form
        onSubmit={e => {
          e.preventDefault()
          run()
        }}
        className={`${dialogPanelClass} p-6 max-w-md w-full mx-4 space-y-4`}
      >
        <h2 className="text-xl font-semibold text-gray-900">Add user</h2>
        {error && (
          <div role="alert" className="p-3 rounded bg-red-50 text-red-700 text-sm">
            {error}
          </div>
        )}
        {field('email', 'Email', 'email')}
        {field('name', 'Name')}
        {field('tempPassword', 'Temporary password (min. 10)', 'password')}
        <div>
          <label htmlFor="new-platform-role" className="block text-sm font-medium text-gray-700 mb-1">
            Platform role
          </label>
          <select
            id="new-platform-role"
            value={form.platformRole}
            className={input}
            onChange={e => setForm({ ...form, platformRole: e.target.value })}
          >
            <option value="user">User</option>
            <option value="admin">Platform admin</option>
          </select>
        </div>
        <p className="text-xs text-gray-500">
          After creating the user, add workspace access in their profile. They can sign in with their email.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-500 rounded-lg text-gray-700"
          >
            Cancel
          </button>
          <button type="submit" disabled={busy} className={buttonClass('primary', 'md', 'flex-1')}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  )
}

function EditAccount({
  account,
  isSelf,
  onClose,
  onSave,
  onDelete,
  onMembershipChanged
}: {
  account: Account
  isSelf: boolean
  onClose: () => void
  onSave: (body: unknown) => Promise<void>
  onMembershipChanged: () => Promise<unknown>
  onDelete: () => Promise<void>
}) {
  const [email, setEmail] = useState(account.email)
  const [name, setName] = useState(account.name)
  const [platformRole, setPlatformRole] = useState(account.platformRole)
  const [newPassword, setNewPassword] = useState('')
  const save = useSubmit(() =>
    onSave({
      ...(email !== account.email ? { email } : {}),
      ...(name !== account.name ? { name } : {}),
      ...(platformRole !== account.platformRole ? { platformRole } : {}),
      ...(newPassword ? { newPassword } : {})
    })
  )
  const ban = useSubmit(() => onSave({ banned: !account.banned }))
  const signOutEverywhere = useSubmit(() => onSave({ revokeSessions: true }))
  const remove = useSubmit(async () => {
    if (confirm(`Delete the account ${account.username}? This cannot be undone.`)) await onDelete()
  })
  const error = save.error || ban.error || remove.error || signOutEverywhere.error
  return (
    <Modal label={`Edit ${account.username}`} onClose={onClose}>
      <div className={`${dialogPanelClass} p-6 max-w-2xl w-full mx-4 space-y-4 max-h-[90vh] overflow-y-auto`}>
        <h2 className="text-xl font-semibold text-gray-900">{account.name}</h2>
        <p className="text-sm text-gray-600">
          {account.email} - Profile and password changes apply across all workspaces.
        </p>
        <WorkspaceAccess user={account} onChanged={onMembershipChanged} />
        {error && (
          <div role="alert" className="p-3 rounded bg-red-50 text-red-700 text-sm">
            {error}
          </div>
        )}
        <form
          onSubmit={e => {
            e.preventDefault()
            save.run()
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="edit-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="edit-email"
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={input}
            />
            <label htmlFor="edit-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input id="edit-name" required value={name} onChange={e => setName(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="edit-platform-role" className="block text-sm font-medium text-gray-700 mb-1">
              Platform role
            </label>
            <select
              id="edit-platform-role"
              value={platformRole}
              className={input}
              onChange={e => setPlatformRole(e.target.value as Account['platformRole'])}
            >
              <option value="user">User</option>
              <option value="admin">Platform admin</option>
            </select>
          </div>
          <div>
            <label htmlFor="edit-password" className="block text-sm font-medium text-gray-700 mb-1">
              New temporary password
            </label>
            <input
              id="edit-password"
              type="password"
              minLength={10}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className={input}
              placeholder="Leave empty to keep"
            />
            <p className="mt-1 text-xs text-gray-500">
              The person must change it at next sign-in; all their sessions end.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-500 rounded-lg text-gray-700"
            >
              Cancel
            </button>
            <button type="submit" disabled={save.busy} className={buttonClass('primary', 'md', 'flex-1')}>
              Save
            </button>
          </div>
        </form>
        {!isSelf && (
          <div className="pt-4 border-t border-gray-200 flex flex-wrap gap-3">
            <button
              onClick={signOutEverywhere.run}
              disabled={signOutEverywhere.busy}
              className={buttonClass('secondary', 'md', 'flex-1')}
            >
              Sign out everywhere
            </button>
            <button
              onClick={ban.run}
              disabled={ban.busy}
              className="flex-1 px-4 py-2 border border-amber-300 text-amber-800 rounded-lg hover:bg-amber-50"
            >
              {account.banned ? 'Enable account' : 'Disable account everywhere'}
            </button>
            <button
              onClick={remove.run}
              disabled={remove.busy}
              className="flex-1 px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
            >
              Delete account
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
