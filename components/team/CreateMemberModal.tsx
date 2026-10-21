'use client'

import { useState } from 'react'
import Modal from '@/components/Modal'
import { generatePassword, type MemberRole, type TeamMember } from '@/lib/team-table'
import { workspaceApi } from '@/lib/workspace/urls'

const input =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900'

type Props = {
  supervisors: TeamMember[]
  /** Platform admins may also add an account that already exists. */
  canAddExisting: boolean
  onClose: () => void
  onCreated: (message: string) => void
}

/**
 * New member: a new account with a temporary password (typed or generated,
 * shown once to copy), or for platform admins an existing account.
 */
export default function CreateMemberModal({ supervisors, canAddExisting, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [form, setForm] = useState({
    username: '',
    email: '',
    name: '',
    role: 'labeller' as MemberRole,
    supervisorId: '',
    tempPassword: '',
    existingUser: ''
  })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const set = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body =
        mode === 'existing'
          ? { existingUser: form.existingUser, role: form.role, supervisorId: form.supervisorId || null }
          : {
              username: form.username,
              email: form.email,
              name: form.name,
              role: form.role,
              supervisorId: form.supervisorId || null,
              tempPassword: form.tempPassword
            }
      const res = await fetch(workspaceApi('/users'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not add the member')
        return
      }
      if (mode === 'existing') {
        onCreated(`${form.existingUser} added to this workspace`)
        return
      }
      // Shown once: the password is not stored anywhere readable.
      setCreated({ username: form.username.toLowerCase(), password: form.tempPassword })
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <Modal
        label="Member created"
        onClose={() => onCreated(`${created.username} created`)}
        className="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-50"
      >
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Member created</h2>
          <p className="text-sm text-gray-700">
            Give these sign-in details to the person. The password is shown only now; they must change it at first
            sign-in.
          </p>
          <pre className="p-3 bg-gray-50 border border-gray-200 rounded text-sm text-gray-900 whitespace-pre-wrap">{`Username: ${created.username}\nPassword: ${created.password}`}</pre>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(`Username: ${created.username}\nPassword: ${created.password}`)
                setCopied(true)
              }}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => onCreated(`${created.username} created`)}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      label="Add member"
      onClose={onClose}
      className="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-50"
    >
      <form onSubmit={submit} className="bg-white rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
        <h2 className="text-xl font-bold text-gray-900">Add member</h2>
        {error && (
          <div role="alert" className="p-3 rounded bg-red-50 text-red-700 text-sm border border-red-200">
            {error}
          </div>
        )}

        {canAddExisting && (
          <fieldset className="flex gap-4 text-sm text-gray-700">
            <legend className="sr-only">Account</legend>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> New account
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Existing account
            </label>
          </fieldset>
        )}

        {mode === 'existing' ? (
          <div>
            <label htmlFor="member-existing" className="block text-sm font-medium text-gray-700 mb-1">
              Username or email
            </label>
            <input
              id="member-existing"
              required
              value={form.existingUser}
              onChange={e => set('existingUser', e.target.value)}
              className={input}
            />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="member-username" className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                id="member-username"
                required
                minLength={3}
                value={form.username}
                onChange={e => set('username', e.target.value)}
                className={input}
              />
            </div>
            <div>
              <label htmlFor="member-email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="member-email"
                type="email"
                required
                value={form.email}
                onChange={e => set('email', e.target.value)}
                className={input}
              />
            </div>
            <div>
              <label htmlFor="member-name" className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input
                id="member-name"
                required
                value={form.name}
                onChange={e => set('name', e.target.value)}
                className={input}
              />
            </div>
            <div>
              <label htmlFor="member-password" className="block text-sm font-medium text-gray-700 mb-1">
                Temporary password
              </label>
              <div className="flex gap-2">
                <input
                  id="member-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={10}
                  value={form.tempPassword}
                  onChange={e => set('tempPassword', e.target.value)}
                  className={input}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="px-3 border border-gray-300 rounded-lg text-sm text-gray-700"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    set('tempPassword', generatePassword())
                    setShowPassword(true)
                  }}
                  className="px-3 border border-gray-300 rounded-lg text-sm text-gray-700"
                >
                  Generate
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                At least 10 characters, not their name; they change it at first sign-in.
              </p>
            </div>
          </>
        )}

        <div>
          <label htmlFor="member-role" className="block text-sm font-medium text-gray-700 mb-1">
            Role in this workspace
          </label>
          <select id="member-role" value={form.role} onChange={e => set('role', e.target.value)} className={input}>
            <option value="labeller">Labeller</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label htmlFor="member-supervisor" className="block text-sm font-medium text-gray-700 mb-1">
            Supervisor
          </label>
          <select
            id="member-supervisor"
            value={form.supervisorId}
            onChange={e => set('supervisorId', e.target.value)}
            className={input}
          >
            <option value="">None</option>
            {supervisors.map(s => (
              <option key={s.id} value={s.id}>
                {s.name || s.username} ({s.role})
              </option>
            ))}
          </select>
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
            disabled={busy}
            className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
          >
            {mode === 'existing' ? 'Add' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
