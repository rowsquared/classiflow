'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { buttonClass } from '@/components/ui/styles'

type Role = 'admin' | 'supervisor' | 'labeller'
type Member = { id: string; name: string; email: string; role: Role; status: string; supervisorId: string | null }
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

export default function WorkspaceAccess({ user, onChanged }: { user: User; onChanged: () => Promise<unknown> }) {
  const [workspaceId, setWorkspaceId] = useState('')
  const { data, isError } = useQuery({
    queryKey: queryKeys.workspaces(),
    queryFn: ({ signal }) => fetchJson<{ workspaces: Workspace[] }>('/api/workspaces', { signal })
  })
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
          workspace={data?.workspaces.find(w => w.id === m.workspace.id) ?? { ...m.workspace, status: 'archived' }}
          onChanged={onChanged}
        />
      ))}
      <label className="block text-sm text-gray-700">
        Add workspace
        <select
          className={control}
          value={workspaceId}
          disabled={!!user.banned}
          onChange={e => setWorkspaceId(e.target.value)}
        >
          <option value="">Choose a workspace</option>
          {data?.workspaces
            .filter(w => w.status === 'active' && !user.memberships.some(m => m.workspace.id === w.id))
            .map(w => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
        </select>
      </label>
      {workspaceId && data?.workspaces.find(w => w.id === workspaceId) && (
        <Membership
          key={workspaceId}
          user={user}
          workspace={data.workspaces.find(w => w.id === workspaceId)!}
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
  onChanged
}: {
  user: User
  workspace: Workspace
  onChanged: () => Promise<unknown>
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
  onChanged
}: {
  member?: Member
  user: User
  workspace: Workspace
  members: Member[]
  onChanged: () => Promise<void>
}) {
  const [role, setRole] = useState<Role>(member?.role ?? 'labeller')
  const [supervisorId, setSupervisorId] = useState(member?.supervisorId ?? '')
  const [unassignOpen, setUnassignOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const disabled = busy || workspace.status !== 'active' || !!user.banned
  const send = async (remove = false) => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const url = `/api/workspaces/${workspace.id}/users${member ? `/${user.id}` : ''}`
      await fetchJson(url, {
        method: remove ? 'DELETE' : member ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          remove
            ? { unassignOpen }
            : member
              ? { role, supervisorId: supervisorId || null, status: 'active' }
              : { existingUserId: user.id, role, supervisorId: supervisorId || null }
        )
      })
      await onChanged()
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
      <label className="block text-sm text-gray-700">
        Supervisor
        <select
          disabled={disabled}
          className={control}
          value={supervisorId}
          onChange={e => setSupervisorId(e.target.value)}
        >
          <option value="">No supervisor</option>
          {members
            .filter(m => m.id !== user.id && m.status === 'active' && m.role !== 'labeller')
            .map(m => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.email})
              </option>
            ))}
        </select>
      </label>
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
      <button type="button" disabled={disabled} className={buttonClass('secondary')} onClick={() => void send()}>
        {member?.status === 'suspended' ? 'Restore access' : member ? 'Save workspace access' : 'Add workspace access'}
      </button>
      {member?.status === 'active' && (
        <>
          <label className="block text-sm text-gray-700">
            <input type="checkbox" checked={unassignOpen} onChange={e => setUnassignOpen(e.target.checked)} /> Unassign
            records that are not submitted when removing access
          </label>
          <button
            type="button"
            disabled={disabled}
            className={buttonClass('secondary')}
            onClick={() => void send(true)}
          >
            Remove from {workspace.name}
          </button>
        </>
      )}
    </div>
  )
}
