'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Modal from '@/components/Modal'

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
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900'

export default function AccountsClient({ currentUserId }: { currentUserId: string }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/users')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setAccounts((await res.json()).users)
      setError(null)
    } catch {
      setError('Could not load the accounts.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const send = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'The change was refused')
    await load()
  }

  return (
    <div className="min-h-screen bg-gray-50 overflow-auto">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Accounts</h1>
            <p className="text-sm text-gray-600">
              Sign-in accounts across all workspaces. Workspace roles are set on each workspace&apos;s Team page.
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/workspaces"
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-white"
            >
              Workspaces
            </Link>
            <button
              onClick={() => setCreating(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              New account
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-4 p-3 rounded bg-red-50 text-red-700 text-sm border border-red-200">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase">
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
                    {a.banned ? ' (banned)' : ''}
                  </td>
                  <td className="px-4 py-3">{a.name}</td>
                  <td className="px-4 py-3 text-gray-600">{a.email}</td>
                  <td className="px-4 py-3">{a.platformRole === 'admin' ? 'Platform admin' : 'User'}</td>
                  <td className="px-4 py-3 text-gray-600">
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
                    <button onClick={() => setEditing(a)} className="text-indigo-600 hover:text-indigo-700">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && accounts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No accounts.
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
            await send('/api/users', 'POST', body)
            setCreating(false)
          }}
        />
      )}
      {editing && (
        <EditAccount
          account={editing}
          isSelf={editing.id === currentUserId}
          onClose={() => setEditing(null)}
          onSave={async body => {
            await send(`/api/users/${editing.id}`, 'PUT', body)
            setEditing(null)
          }}
          onDelete={async () => {
            await send(`/api/users/${editing.id}`, 'DELETE')
            setEditing(null)
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
  const [form, setForm] = useState({ username: '', email: '', name: '', platformRole: 'user', tempPassword: '' })
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
    <Modal
      label="New account"
      onClose={onClose}
      className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50"
    >
      <form
        onSubmit={e => {
          e.preventDefault()
          run()
        }}
        className="bg-white rounded-lg p-6 max-w-md w-full mx-4 space-y-4"
      >
        <h2 className="text-xl font-bold text-gray-900">New account</h2>
        {error && (
          <div role="alert" className="p-3 rounded bg-red-50 text-red-700 text-sm">
            {error}
          </div>
        )}
        {field('username', 'Username')}
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
        <p className="text-xs text-gray-500">Add the account to workspaces from their Team pages.</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
          >
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
  onDelete
}: {
  account: Account
  isSelf: boolean
  onClose: () => void
  onSave: (body: unknown) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name, setName] = useState(account.name)
  const [platformRole, setPlatformRole] = useState(account.platformRole)
  const [newPassword, setNewPassword] = useState('')
  const save = useSubmit(() =>
    onSave({
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
    <Modal
      label={`Edit ${account.username}`}
      onClose={onClose}
      className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50"
    >
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
        <h2 className="text-xl font-bold text-gray-900">{account.username}</h2>
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
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.busy}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </form>
        {!isSelf && (
          <div className="pt-4 border-t border-gray-200 flex flex-wrap gap-3">
            <button
              onClick={signOutEverywhere.run}
              disabled={signOutEverywhere.busy}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Sign out everywhere
            </button>
            <button
              onClick={ban.run}
              disabled={ban.busy}
              className="flex-1 px-4 py-2 border border-amber-300 text-amber-800 rounded-lg hover:bg-amber-50"
            >
              {account.banned ? 'Lift ban' : 'Ban (sign out everywhere)'}
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
