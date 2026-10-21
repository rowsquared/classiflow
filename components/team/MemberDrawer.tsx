'use client'

import { useState } from 'react'
import Link from 'next/link'
import Modal from '@/components/Modal'
import Combobox from '@/components/ui/Combobox'
import { formatRelativeTime } from '@/lib/utils'
import { generatePassword, type MemberRole, type TeamMember } from '@/lib/team-table'
import { useWorkspacePaths, workspaceApi } from '@/lib/workspace/urls'
import { mailPurposeLabel, mailStatusLabel } from '@/components/team/mail-status'

const input =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900'

type Props = {
  member: TeamMember
  supervisors: TeamMember[]
  isSelf: boolean
  mailEnabled: boolean
  onClose: () => void
  /** Called after a successful change, with a message for the toast. */
  onChanged: (message: string) => void
}

const when = (value: string | null) => (value ? formatRelativeTime(value) : 'Never')

/**
 * One member: profile, role and supervisor in this workspace, the account's
 * name, email and temporary password, password and invitation links by mail,
 * removal (suspension) and links to their history in the workspace audit log.
 */
export default function MemberDrawer({ member, supervisors, isSelf, mailEnabled, onClose, onChanged }: Props) {
  const { href } = useWorkspacePaths()
  const [role, setRole] = useState<MemberRole>(member.role)
  const [supervisorId, setSupervisorId] = useState(member.supervisorId ?? '')
  const [name, setName] = useState(member.name ?? '')
  const [email, setEmail] = useState(member.email)
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [unassignOpen, setUnassignOpen] = useState(false)

  const call = async (method: 'PUT' | 'DELETE' | 'POST', body: unknown, message: string, path = '') => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(workspaceApi(`/users/${member.id}${path}`), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'The change was refused')
        return
      }
      onChanged(message)
    } finally {
      setBusy(false)
    }
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    call(
      'PUT',
      {
        role,
        supervisorId: supervisorId || null,
        // Account fields: sent only when changed; the server decides who may.
        ...(name !== (member.name ?? '') ? { name } : {}),
        ...(email.trim().toLowerCase() !== member.email ? { email } : {}),
        ...(newPassword ? { newPassword } : {})
      },
      `${member.username} updated`
    )
  }

  const possibleSupervisors = supervisors.filter(s => s.id !== member.id)
  const userAudit = href(`/admin/audit?entityType=user&entityId=${member.id}`)
  const actorAudit = href(`/admin/audit?actorId=${member.id}`)

  return (
    <Modal
      label={`Member ${member.username}`}
      onClose={onClose}
      closeOnOverlayClick
      className="fixed inset-0 bg-gray-900/40 flex justify-end z-50"
    >
      <aside className="bg-white w-full max-w-lg h-full overflow-y-auto p-6 space-y-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{member.name || member.username}</h2>
            <p className="text-sm text-gray-600">
              {member.username} · {member.email}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Close">
            ✕
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">Status</dt>
            <dd className="text-gray-900">
              {member.status === 'suspended' ? 'Removed' : 'Active'}
              {member.mustResetPassword ? ' · must reset password' : ''}
              {member.invitationPending ? ' · invitation not used yet' : ''}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Assigned records</dt>
            <dd className="text-gray-900">{member._count.assignedSentences}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Last seen here</dt>
            <dd className="text-gray-900" title={member.lastSeenAt ?? undefined}>
              {when(member.lastSeenAt)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Last sign-in</dt>
            <dd className="text-gray-900" title={member.lastLogin ?? undefined}>
              {when(member.lastLogin)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Added here</dt>
            <dd className="text-gray-900" title={member.createdAt}>
              {when(member.createdAt)}
              {member.addedBy ? ` by ${member.addedBy}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Account created</dt>
            <dd className="text-gray-900" title={member.accountCreatedAt}>
              {when(member.accountCreatedAt)}
            </dd>
          </div>
          {member.lastMail && (
            <div className="col-span-2">
              <dt className="text-gray-500">Last email from this workspace</dt>
              <dd className="text-gray-900" title={member.lastMail.createdAt}>
                {mailPurposeLabel(member.lastMail.purpose)}: {mailStatusLabel(member.lastMail.status)},{' '}
                {when(member.lastMail.createdAt)}
              </dd>
            </div>
          )}
          <div className="col-span-2">
            <dt className="text-gray-500">Supervises</dt>
            <dd className="text-gray-900">
              {member.labellers.length ? member.labellers.map(l => l.name || l.email).join(', ') : '—'}
            </dd>
          </div>
        </dl>

        {error && (
          <div role="alert" className="p-3 rounded bg-red-50 text-red-700 text-sm border border-red-200">
            {error}
          </div>
        )}

        {member.status === 'suspended' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => call('PUT', { status: 'active' }, `${member.username} reactivated`)}
            className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
          >
            Reactivate in this workspace
          </button>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div>
              <label htmlFor="drawer-role" className="block text-sm font-medium text-gray-700 mb-1">
                Role in this workspace
              </label>
              <select
                id="drawer-role"
                value={role}
                onChange={e => setRole(e.target.value as MemberRole)}
                className={input}
              >
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
                options={possibleSupervisors.map(s => ({ value: s.id, label: s.name || s.username, hint: s.role }))}
                value={supervisorId || null}
                onChange={value => setSupervisorId(value ?? '')}
              />
            </div>
            <div>
              <label htmlFor="drawer-name" className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input id="drawer-name" required value={name} onChange={e => setName(e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="drawer-email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="drawer-email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={input}
              />
            </div>
            <div>
              <label htmlFor="drawer-password" className="block text-sm font-medium text-gray-700 mb-1">
                New temporary password
              </label>
              <div className="flex gap-2">
                <input
                  id="drawer-password"
                  type="text"
                  minLength={10}
                  value={newPassword}
                  placeholder="Leave empty to keep"
                  onChange={e => setNewPassword(e.target.value)}
                  className={input}
                />
                <button
                  type="button"
                  onClick={() => setNewPassword(generatePassword())}
                  className="px-3 border border-gray-300 rounded-lg text-sm text-gray-700"
                >
                  Generate
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Name, email and password belong to the account. Workspace admins can change them only for accounts used
                in this workspace alone that have never signed in; otherwise ask a platform admin.
              </p>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
            >
              Save
            </button>
          </form>
        )}

        {mailEnabled && member.status === 'active' && (
          <section className="space-y-2 text-sm">
            <h3 className="font-medium text-gray-900">Email</h3>
            <div className="flex flex-wrap gap-2">
              {member.invitationPending ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    call('POST', { purpose: 'invitation' }, `Invitation sent again to ${member.username}`, '/mail')
                  }
                  className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Resend invitation
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    call('POST', { purpose: 'password_link' }, `Password link sent to ${member.username}`, '/mail')
                  }
                  className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Send password link
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500">
              A link lets them choose a password themselves; nobody else sees it. Same account rule as above.
            </p>
          </section>
        )}

        <section className="space-y-2 text-sm">
          <h3 className="font-medium text-gray-900">History in this workspace</h3>
          <Link href={userAudit} className="block text-indigo-700 underline">
            Changes to this member
          </Link>
          <Link href={actorAudit} className="block text-indigo-700 underline">
            Actions by this member
          </Link>
        </section>

        {member.status === 'active' && !isSelf && (
          <section className="pt-4 border-t border-gray-200">
            {confirmRemove ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  {member.username} loses access to this workspace. Their labels and comments stay, and you can
                  reactivate them later.
                </p>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={unassignOpen} onChange={e => setUnassignOpen(e.target.checked)} />
                  Also remove their assignments on records that are not submitted
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => call('DELETE', { unassignOpen }, `${member.username} removed from this workspace`)}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                className="w-full px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100"
              >
                Remove from workspace
              </button>
            )}
          </section>
        )}
      </aside>
    </Modal>
  )
}
