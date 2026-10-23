'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { buttonClass } from '@/components/ui/styles'
import Combobox from '@/components/ui/Combobox'
import Modal from '@/components/Modal'
import { dialogPanelClass } from '@/components/ui/styles'
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
  'w-full border border-gray-500 px-3 py-2 text-sm text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-600'

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
  return (
    <section aria-label="Workspace access" className="border-y border-gray-200 py-4 space-y-3">
      <h3 className="font-medium text-gray-900">Workspace access</h3>
      {user.platformRole === 'admin' && (
        <p className="text-sm text-gray-700">
          All workspaces: this person is a platform administrator. Changing memberships does not restrict that access.
        </p>
      )}
      {user.banned && (
        <p className="text-sm text-gray-700">
          This account is disabled globally. Enable it before granting workspace access.
        </p>
      )}
      {isError && <p role="alert">Could not load workspaces.</p>}
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
      <Combobox
        label="Add to workspace"
        value={workspaceId || null}
        disabled={!!user.banned}
        onChange={id => setWorkspaceId(id ?? '')}
        options={workspaces
          .filter(w => w.status === 'active' && !user.memberships.some(m => m.workspace.id === w.id))
          .map(w => ({ value: w.id, label: w.name }))}
      />
      {workspaceId && workspaces.find(w => w.id === workspaceId) && (
        <Membership
          key={workspaceId}
          user={user}
          workspace={workspaces.find(w => w.id === workspaceId)!}
          platform={platform}
          mailEnabled={mailEnabled}
          onChanged={async () => {
            await onChanged()
            setWorkspaceId('')
          }}
        />
      )}
    </section>
  )
}

function Membership({
  user,
  workspace,
  onChanged,
  platform,
  mailEnabled
}: {
  user: User
  workspace: Workspace
  onChanged: () => Promise<unknown>
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
  if (isPending) return <p role="status">Loading {workspace.name}…</p>
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
  platform,
  mailEnabled
}: {
  member?: Member
  user: User
  workspace: Workspace
  members: Member[]
  onChanged: () => Promise<void>
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
  const disabled = busy || workspace.status !== 'active' || !!user.banned
  const send = async (remove = false) => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const invite = !member && !platform
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
  return (
    <div className="border border-gray-200 p-3 space-y-2">
      <p className="font-medium text-gray-900">
        {workspace.name} {member?.status === 'suspended' ? '(removed)' : ''}
        {workspace.status !== 'active' ? ' (archived, read-only)' : ''}
      </p>
      <label className="block text-sm text-gray-700">
        Workspace role
        <select disabled={disabled} className={control} value={role} onChange={e => setRole(e.target.value as Role)}>
          <option value="labeller">Labeller</option>
          <option value="supervisor">Supervisor</option>
          <option value="admin">Workspace admin</option>
        </select>
      </label>
      <Combobox
        label={`Supervisor in ${workspace.name}`}
        disabled={disabled}
        value={supervisorId || null}
        onChange={id => setSupervisorId(id ?? '')}
        options={members
          .filter(m => m.id !== user.id && m.status === 'active' && m.role !== 'labeller')
          .map(m => ({ value: m.id, label: m.name, hint: m.email }))}
        placeholder="No supervisor"
      />
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-gray-700">
          Workspace access saved.
        </p>
      )}
      <button
        type="button"
        disabled={disabled || (!member && !platform && !mailEnabled)}
        className={buttonClass('secondary')}
        onClick={() => void send()}
      >
        {member?.status === 'suspended'
          ? 'Restore access'
          : member
            ? 'Save workspace access'
            : platform
              ? 'Add workspace access'
              : 'Send invitation'}
      </button>
      {member && (
        <button
          type="button"
          className={buttonClass('ghost')}
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
      {!member && !platform && !mailEnabled && (
        <p className="text-sm text-gray-600">
          Email must be configured to invite an existing account. A platform admin can grant access directly.
        </p>
      )}
      {member && (
        <details className="text-sm text-gray-700">
          <summary className="cursor-pointer">History in {workspace.name}</summary>
          <p>Assigned records: {member._count.assignedSentences}</p>
          <p>Last seen here: {member.lastSeenAt ? formatRelativeTime(member.lastSeenAt) : 'Never'}</p>
          <p>
            Added here: {formatRelativeTime(member.createdAt)}
            {member.addedBy ? ` by ${member.addedBy}` : ''}
          </p>
          <p>Access last changed: {formatRelativeTime(member.updatedAt)}</p>
          {member.lastMail && (
            <p>
              Last workspace email: {mailStatusLabel(member.lastMail.status)} ·{' '}
              {formatRelativeTime(member.lastMail.createdAt)}
            </p>
          )}
          <a className="text-indigo-700 underline" href={`/w/${workspace.id}/progress?personId=${user.id}`}>
            Labelling progress
          </a>
          {' · '}
          <a className="text-indigo-700 underline" href={`/w/${workspace.id}/admin/audit?actorId=${user.id}`}>
            Administrative actions
          </a>{' '}
          ·{' '}
          <a
            className="text-indigo-700 underline"
            href={`/w/${workspace.id}/admin/audit?entityType=user&entityId=${user.id}`}
          >
            Access history
          </a>
        </details>
      )}
      {member?.status === 'active' && (
        <>
          <button
            type="button"
            disabled={busy || workspace.status !== 'active'}
            className={buttonClass('secondary')}
            onClick={() => setConfirmRemove(true)}
          >
            Remove from {workspace.name}
          </button>
        </>
      )}
      {confirmRemove && (
        <Modal
          label="Remove workspace access"
          onClose={() => {
            if (!busy) setConfirmRemove(false)
          }}
        >
          <div className={`${dialogPanelClass} max-w-md p-6 space-y-4`}>
            <h3 className="text-lg font-medium">Remove workspace access</h3>
            <p>
              Remove {user.email} from {workspace.name}? Their labels, comments and history are kept.
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
            <button className={buttonClass('secondary')} disabled={busy} onClick={() => setConfirmRemove(false)}>
              Cancel
            </button>
            <button className={buttonClass('danger')} disabled={busy} onClick={() => void send(true)}>
              Remove access
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
