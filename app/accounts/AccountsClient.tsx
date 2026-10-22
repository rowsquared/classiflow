'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import WorkspaceAccess from '@/components/team/WorkspaceAccess'
import Modal from '@/components/Modal'
import QueryProvider from '@/components/QueryProvider'
import { fetchJson } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
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

const input =
  'w-full px-3 py-2 border border-gray-500 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-gray-900'

// /accounts is outside any workspace, so it has its own query cache.
export default function AccountsClient({ currentUserId }: { currentUserId: string }) {
  return (
    <QueryProvider>
      <Accounts currentUserId={currentUserId} />
    </QueryProvider>
  )
}

function Accounts({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [workspaceFilter, setWorkspaceFilter] = useState('')

  const {
    data,
    isPending: loading,
    isError
  } = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: ({ signal }) => fetchJson<{ users: Account[] }>('/api/users', { signal })
  })
  const accounts = data?.users ?? []
  const editing = accounts.find(a => a.id === editingId) ?? null
  const shown = accounts.filter(
    a =>
      (!search || [a.name, a.email, a.username].some(v => v.toLowerCase().includes(search.toLowerCase()))) &&
      (!workspaceFilter ||
        (workspaceFilter === 'none'
          ? a.platformRole !== 'admin' && !a.memberships.some(m => m.status === 'active')
          : a.platformRole === 'admin' ||
            a.memberships.some(m => m.workspace.id === workspaceFilter && m.status === 'active')))
  )
  const workspaceOptions = [
    ...new Map(accounts.flatMap(a => a.memberships.map(m => [m.workspace.id, m.workspace] as const))).values()
  ]

  const error = isError ? 'Could not load the accounts.' : null
  const load = () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })

  const send = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'The change was refused')
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
        <div className="flex gap-3 mb-4">
          <label className="flex-1 text-sm text-gray-700">
            Search users
            <input className={input} value={search} onChange={e => setSearch(e.target.value)} type="search" />
          </label>
          <label className="text-sm text-gray-700">
            Workspace access
            <select className={input} value={workspaceFilter} onChange={e => setWorkspaceFilter(e.target.value)}>
              <option value="">All users</option>
              <option value="none">No workspace access</option>
              {workspaceOptions.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading && <p role="status">Loading users - </p>}
        <div className={`${panelClass} overflow-x-auto`}>
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
              {shown.map(a => (
                <tr key={a.id} className={a.banned ? 'opacity-60' : ''}>
                  <td className="px-4 py-3">
                    {a.username}
                    {a.banned ? ' (banned)' : ''}
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
              {!loading && shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-600">
                    No users match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {creating && (
        <CreateAccount
          onClose={() => setCreating(false)}
          onSave={async body => {
            const email = (body as { email: string }).email.trim().toLowerCase()
            const existing = accounts.find(a => a.email === email)
            if (existing) {
              setCreating(false)
              setEditingId(existing.id)
              return
            }
            const result = await send('/api/users', 'POST', body)
            setCreating(false)
            setEditingId(result.user.id)
          }}
        />
      )}
      {editing && (
        <EditAccount
          key={editing.id}
          account={editing}
          onMembershipChanged={load}
          isSelf={editing.id === currentUserId}
          onClose={() => setEditingId(null)}
          onSave={async body => {
            await send(`/api/users/${editing.id}`, 'PUT', body)
            setEditingId(null)
          }}
          onDelete={async () => {
            await send(`/api/users/${editing.id}`, 'DELETE')
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
