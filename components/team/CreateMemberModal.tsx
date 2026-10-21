'use client'

import { useState } from 'react'
import Modal from '@/components/Modal'
import Combobox from '@/components/ui/Combobox'
import { generatePassword, type MemberRole, type TeamMember } from '@/lib/team-table'
import { workspaceApi } from '@/lib/workspace/urls'

const input =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900'

type Props = {
  supervisors: TeamMember[]
  /** Platform admins may also add an account that already exists. */
  canAddExisting: boolean
  mailEnabled: boolean
  onClose: () => void
  onCreated: (message: string) => void
}

type Access = 'invite' | 'email_password' | 'password'

/**
 * New member. A new account gets access by an invitation link to choose a
 * password, a generated temporary password by email (both need mail), or a
 * temporary password the admin hands over (typed or generated, shown once to
 * copy). Anyone, including people with an account already, can be invited by
 * email to join; platform admins can also add an existing account directly.
 */
export default function CreateMemberModal({ supervisors, canAddExisting, mailEnabled, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<'new' | 'invite' | 'existing'>('new')
  const [access, setAccess] = useState<Access>(mailEnabled ? 'invite' : 'password')
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
          : mode === 'invite'
            ? { email: form.email, role: form.role, supervisorId: form.supervisorId || null }
            : {
                username: form.username,
                email: form.email,
                name: form.name,
                role: form.role,
                supervisorId: form.supervisorId || null,
                access,
                ...(access === 'password' ? { tempPassword: form.tempPassword } : {})
              }
      const res = await fetch(workspaceApi(mode === 'invite' ? '/invitations' : '/users'), {
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
      if (mode === 'invite') {
        onCreated(`Invitation sent to ${form.email.toLowerCase()}`)
        return
      }
      if (access !== 'password') {
        onCreated(
          access === 'invite'
            ? `${form.username.toLowerCase()} created; an invitation link is on its way`
            : `${form.username.toLowerCase()} created; sign-in details are on their way by email`
        )
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

        {(canAddExisting || mailEnabled) && (
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-700">
            <legend className="sr-only">Account</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="member-mode" checked={mode === 'new'} onChange={() => setMode('new')} /> New
              account
            </label>
            {mailEnabled && (
              <label className="flex items-center gap-2">
                <input type="radio" name="member-mode" checked={mode === 'invite'} onChange={() => setMode('invite')} />{' '}
                Invite by email
              </label>
            )}
            {canAddExisting && (
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="member-mode"
                  checked={mode === 'existing'}
                  onChange={() => setMode('existing')}
                />{' '}
                Existing account
              </label>
            )}
          </fieldset>
        )}

        {mode === 'invite' ? (
          <div>
            <label htmlFor="member-invite-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="member-invite-email"
              type="email"
              required
              value={form.email}
              onChange={e => set('email', e.target.value)}
              className={input}
            />
            <p className="mt-1 text-xs text-gray-500">
              For people who already have a classiflow account (or will get one): they accept the invitation signed in
              with the account that uses this address.
            </p>
          </div>
        ) : mode === 'existing' ? (
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
            {mailEnabled && (
              <fieldset className="space-y-1 text-sm text-gray-700">
                <legend className="block text-sm font-medium text-gray-700 mb-1">Access</legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="member-access"
                    checked={access === 'invite'}
                    onChange={() => setAccess('invite')}
                  />{' '}
                  Email a link to choose a password
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="member-access"
                    checked={access === 'email_password'}
                    onChange={() => setAccess('email_password')}
                  />{' '}
                  Generate and email a temporary password
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="member-access"
                    checked={access === 'password'}
                    onChange={() => setAccess('password')}
                  />{' '}
                  Set a temporary password and hand it over myself
                </label>
              </fieldset>
            )}
            {access === 'password' && (
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
            )}
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
          <Combobox
            label="Supervisor"
            labelClassName="block text-sm font-medium text-gray-700 mb-1"
            placeholder="None"
            inputClassName="!px-3 !py-2 border-gray-300 rounded-lg text-gray-900"
            options={supervisors.map(s => ({ value: s.id, label: s.name || s.username, hint: s.role }))}
            value={form.supervisorId || null}
            onChange={value => set('supervisorId', value ?? '')}
          />
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
            {mode === 'existing' ? 'Add' : mode === 'invite' ? 'Send invitation' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
