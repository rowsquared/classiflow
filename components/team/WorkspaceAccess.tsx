'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { badgeClass, buttonClass, dialogPanelClass, panelClass } from '@/components/ui/styles'
import Combobox from '@/components/ui/Combobox'
import Modal from '@/components/Modal'
import { formatRelativeTime } from '@/lib/utils'
import { mailStatusLabel } from '@/components/team/mail-status'

type Role = 'admin' | 'supervisor' | 'labeller'
type Member = {
  id: string
  name: string
  email: string
  role: Role
  status: string
  supervisorId: string | null
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
  addedBy: string | null
  _count: { assignedSentences: number }
  lastMail: { status: string; createdAt: string } | null
}
type Workspace = { id: string; name: string; status: string }
type User = {
  id: string
  email: string
  platformRole: string
  banned: boolean | null
  memberships: Array<{ workspace: { id: string; name: string }; role: string; status: string }>
}
const control =
  'mt-1 w-full border border-gray-500 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-600'
const fieldLabel = 'block text-sm text-gray-700'
const link = 'text-indigo-700 underline hover:text-indigo-900'

/** One card per workspace the person belongs to, then a picker to add another. */
export default function WorkspaceAccess({
  user,
  onChanged,
  allowedWorkspaces,
  platform = true,
  mailEnabled = false
}: {
  user: User
  onChanged: () => Promise<unknown>
  allowedWorkspaces?: Workspace[]
  platform?: boolean
  mailEnabled?: boolean
}) {
  const [workspaceId, setWorkspaceId] = useState('')
  const { data, isError } = useQuery({
    queryKey: queryKeys.workspaces(),
    queryFn: ({ signal }) => fetchJson<{ workspaces: Workspace[] }>('/api/workspaces', { signal })
  })
  const workspaces = allowedWorkspaces ?? data?.workspaces ?? []
  const addable = workspaces.filter(w => w.status === 'active' && !user.memberships.some(m => m.workspace.id === w.id))
  const adding = workspaceId ? workspaces.find(w => w.id === workspaceId) : undefined
  return (
    <div className="space-y-3">
      {user.platformRole === 'admin' && (
        <p className="border-l-2 border-indigo-600 bg-indigo-50 px-3 py-2 text-sm text-gray-800">
          Platform administrator: admin in every workspace. The roles below only matter if that is removed.
        </p>
      )}
      {user.banned && (
        <p className="border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-gray-800">
          This account is disabled. Enable it (Account tab) before changing workspace access.
        </p>
      )}
      {isError && <p role="alert">Could not load workspaces.</p>}
      {user.memberships.length === 0 && !adding && (
        <p className="text-sm text-gray-600">Not a member of any workspace yet.</p>
      )}
      {user.memberships.map(m => (
        <Membership
          key={m.workspace.id}
          user={user}
          workspace={workspaces.find(w => w.id === m.workspace.id) ?? { ...m.workspace, status: 'archived' }}
          onChanged={onChanged}
          platform={platform}
          mailEnabled={mailEnabled}
        />
      ))}
      {adding && (
        <Membership
          key={adding.id}
          user={user}
          workspace={adding}
          platform={platform}
          mailEnabled={mailEnabled}
          onCancel={() => setWorkspaceId('')}
          onChanged={async () => {
            await onChanged()
            setWorkspaceId('')
          }}
        />
      )}
      {addable.length > 0 && !adding && (
        <div className="pt-1">
          <Combobox
            label="Add to workspace"
            labelClassName={`${fieldLabel} mb-1`}
            placeholder="Choose a workspace…"
            value={null}
            disabled={!!user.banned}
            onChange={id => setWorkspaceId(id ?? '')}
            options={addable.map(w => ({ value: w.id, label: w.name }))}
          />
        </div>
      )}
    </div>
  )
}

function Membership({
  user,
  workspace,
  onChanged,
  onCancel,
  platform,
  mailEnabled
}: {
  user: User
  workspace: Workspace
  onChanged: () => Promise<unknown>
  onCancel?: () => void
  platform: boolean
  mailEnabled: boolean
}) {
  const cache = useQueryClient()
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.members(workspace.id),
    queryFn: ({ signal }) =>
      fetchJson<{ users: Member[] }>(`/api/workspaces/${workspace.id}/users?includeSuspended=true`, { signal })
  })
  const member = data?.users.find(m => m.id === user.id)
  if (isPending)
    return (
      <p role="status" className={`${panelClass} p-4 text-sm text-gray-600`}>
        Loading {workspace.name}…
      </p>
    )
  if (isError) return <p role="alert">Could not load members of {workspace.name}.</p>
  return (
    <MembershipForm
      key={JSON.stringify(member)}
      member={member}
      user={user}
      workspace={workspace}
      members={data.users}
      platform={platform}
      mailEnabled={mailEnabled}
      onCancel={onCancel}
      onChanged={async () => {
        await cache.invalidateQueries({ queryKey: queryKeys.workspace(workspace.id) })
        await onChanged()
      }}
    />
  )
}

function MembershipForm({
  member,
  user,
  workspace,
  members,
  onChanged,
  onCancel,
  platform,
  mailEnabled
}: {
  member?: Member
  user: User
  workspace: Workspace
  members: Member[]
  onChanged: () => Promise<void>
  onCancel?: () => void
  platform: boolean
  mailEnabled: boolean
}) {
  const [role, setRole] = useState<Role>(member?.role ?? 'labeller')
  const [supervisorId, setSupervisorId] = useState(member?.supervisorId ?? '')
  const [unassignOpen, setUnassignOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const archived = workspace.status !== 'active'
  const removed = member?.status === 'suspended'
  const disabled = busy || archived || !!user.banned
  const invite = !member && !platform
  const dirty = !member || removed || role !== member.role || supervisorId !== (member.supervisorId ?? '')
  const send = async (remove = false) => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const url = `/api/workspaces/${workspace.id}/${invite ? 'invitations' : `users${member ? `/${user.id}` : ''}`}`
      await fetchJson(url, {
        method: remove ? 'DELETE' : member ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          remove
            ? { unassignOpen }
            : member
              ? { role, supervisorId: supervisorId || null, status: 'active' }
              : invite
                ? { email: user.email, role, supervisorId: supervisorId || null }
                : { existingUserId: user.id, role, supervisorId: supervisorId || null }
        )
      })
      await onChanged()
      setConfirmRemove(false)
      setSaved(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save membership')
    } finally {
      setBusy(false)
    }
  }
  const facts = member
    ? [
        `${member._count.assignedSentences} assigned ${member._count.assignedSentences === 1 ? 'record' : 'records'}`,
        member.lastSeenAt ? `last seen ${formatRelativeTime(member.lastSeenAt)}` : 'never opened',
        `added ${formatRelativeTime(member.createdAt)}${member.addedBy ? ` by ${member.addedBy}` : ''}`,
        member.lastMail
          ? `${mailStatusLabel(member.lastMail.status)} ${formatRelativeTime(member.lastMail.createdAt)}`
          : null
      ].filter(Boolean)
    : []
  return (
    <section aria-label={workspace.name} className={`${panelClass} space-y-3 p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
            {workspace.name}
            {!member && <span className={badgeClass('accent')}>New</span>}
            {removed && <span className={badgeClass('danger')}>Removed</span>}
            {archived && <span className={badgeClass('neutral')}>Archived · read-only</span>}
          </p>
          {facts.length > 0 && <p className="mt-0.5 text-xs text-gray-600">{facts.join(' · ')}</p>}
        </div>
        {member?.status === 'active' && (
          <button
            type="button"
            aria-label={`Remove from ${workspace.name}`}
            disabled={busy || archived}
            className={buttonClass('ghost', 'sm', 'text-red-700 hover:text-red-800')}
            onClick={() => setConfirmRemove(true)}
          >
            Remove
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={fieldLabel}>
          Workspace role
          <select disabled={disabled} className={control} value={role} onChange={e => setRole(e.target.value as Role)}>
            <option value="labeller">Labeller</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Workspace admin</option>
          </select>
        </label>
        {role !== 'admin' && (
          <Combobox
            label="Supervisor"
            labelClassName={`${fieldLabel} mb-1`}
            disabled={disabled}
            value={supervisorId || null}
            onChange={id => setSupervisorId(id ?? '')}
            options={members
              .filter(m => m.id !== user.id && m.status === 'active' && m.role !== 'labeller')
              .map(m => ({ value: m.id, label: m.name, hint: m.email }))}
            placeholder="No supervisor"
          />
        )}
      </div>
      {invite && !mailEnabled && (
        <p className="text-sm text-gray-600">
          Email is not set up, so you cannot invite an existing account. A platform admin can add them directly.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-700">
          {member && (
            <>
              <a className={link} href={`/w/${workspace.id}/progress?personId=${user.id}`}>
                Progress
              </a>
              {' · '}
              <a className={link} href={`/w/${workspace.id}/admin/audit?actorId=${user.id}`}>
                Actions taken
              </a>
              {' · '}
              <a className={link} href={`/w/${workspace.id}/admin/audit?entityType=user&entityId=${user.id}`}>
                Access changes
              </a>
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          {saved && !dirty && (
            <span role="status" className="text-sm text-gray-700">
              Saved.
            </span>
          )}
          {member && !removed && dirty && (
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              disabled={busy}
              onClick={() => {
                setRole(member.role)
                setSupervisorId(member.supervisorId ?? '')
                setError('')
              }}
            >
              Cancel changes
            </button>
          )}
          {onCancel && (
            <button type="button" className={buttonClass('ghost', 'sm')} disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={disabled || !dirty || (invite && !mailEnabled)}
            className={buttonClass('primary', 'sm')}
            onClick={() => void send()}
          >
            {removed
              ? 'Restore access'
              : member
                ? 'Save workspace access'
                : platform
                  ? 'Add workspace access'
                  : 'Send invitation'}
          </button>
        </div>
      </div>
      {confirmRemove && (
        <Modal
          label="Remove workspace access"
          onClose={() => {
            if (!busy) setConfirmRemove(false)
          }}
        >
          <div className={`${dialogPanelClass} max-w-md space-y-4 p-6`}>
            <h3 className="text-lg font-medium">Remove workspace access</h3>
            <p>
              Remove {user.email} from {workspace.name}? Their labels, comments and history are kept, and you can
              restore access later.
            </p>
            <label className="block text-sm">
              <input type="checkbox" checked={unassignOpen} onChange={e => setUnassignOpen(e.target.checked)} />{' '}
              Unassign records that are not submitted
            </label>
            {error && (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button className={buttonClass('secondary')} disabled={busy} onClick={() => setConfirmRemove(false)}>
                Cancel
              </button>
              <button className={buttonClass('danger')} disabled={busy} onClick={() => void send(true)}>
                Remove access
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}
