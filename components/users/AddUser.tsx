'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Modal from '@/components/Modal'
import Combobox from '@/components/ui/Combobox'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'
import { fetchJson, HttpError } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { controlClass, type Workspace } from './types'
import { generatePassword } from '@/lib/team-table'
import { useDebouncedValue } from '@/lib/use-debounced-value'

type Grant = { key: string; workspaceId: string; role: 'labeller' | 'supervisor' | 'admin'; supervisorId: string }
type Outcome = { workspaceId: string; ok: boolean; message: string }
export default function AddUser({
  platform,
  workspaces,
  defaultWorkspace,
  mailEnabled,
  onClose,
  onChanged
}: {
  platform: boolean
  workspaces: Workspace[]
  defaultWorkspace?: string
  mailEnabled: boolean
  onClose: () => void
  onChanged: () => Promise<unknown>
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [access, setAccess] = useState(mailEnabled ? 'invite' : 'password')
  const [password, setPassword] = useState('')
  const [grants, setGrants] = useState<Grant[]>([
    { key: 'first', workspaceId: defaultWorkspace ?? '', role: 'labeller', supervisorId: '' }
  ])
  const [accountId, setAccountId] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [accountMessage, setAccountMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [createdNew, setCreatedNew] = useState(false)
  const normalizedEmail = email.trim().toLowerCase()
  const lookupEmail = useDebouncedValue(normalizedEmail, 300)
  const lookup = useQuery({
    queryKey: queryKeys.accountLookup(lookupEmail),
    enabled: platform && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lookupEmail),
    queryFn: ({ signal }) =>
      fetchJson<{ user: { id: string; name: string; banned: boolean | null } | null }>(
        `/api/users/lookup?email=${encodeURIComponent(lookupEmail)}`,
        { signal }
      )
  })
  const existing = lookupEmail === normalizedEmail ? lookup.data?.user : null
  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    let targetId = accountId ?? existing?.id ?? null
    try {
      const chosen = grants.filter(g => g.workspaceId)
      if (existing) {
        setAccountId(existing.id)
        setAccountMessage('Existing account reused. Its profile and sign-in details are unchanged.')
      }
      if (!chosen.length && !platform) throw new Error('Choose a workspace')
      if (!targetId && platform) {
        try {
          const result = await fetchJson<{ user: { id: string } }>('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: normalizedEmail,
              name,
              access,
              ...(access === 'password' ? { tempPassword: password } : {})
            })
          })
          targetId = result.user.id
          setCreatedNew(true)
          setAccountMessage('Account created.')
          setAccountId(targetId)
        } catch (caught) {
          const existing =
            caught instanceof HttpError ? (caught.body as { existingUserId?: string }).existingUserId : null
          if (!existing) throw caught
          targetId = existing
          setAccountId(existing)
          setAccountMessage('Existing account reused. Its profile and sign-in details are unchanged.')
        }
      }
      for (const grant of chosen) {
        if (outcomes.some(o => o.workspaceId === grant.workspaceId && o.ok)) continue
        try {
          const invitation = !platform && access === 'invite'
          const result = await fetchJson<{ user?: { id: string } }>(
            `/api/workspaces/${grant.workspaceId}/${invitation ? 'invitations' : 'users'}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                role: grant.role,
                supervisorId: grant.supervisorId || null,
                ...(invitation
                  ? { email: normalizedEmail }
                  : targetId
                    ? { existingUserId: targetId }
                    : { email: normalizedEmail, name, access: 'password', tempPassword: password })
              })
            }
          )
          if (!platform && result.user) {
            targetId = result.user.id
            setAccountId(targetId)
            setCreatedNew(true)
            setAccountMessage('Account created.')
          }
          setOutcomes(previous => [
            ...previous.filter(o => o.workspaceId !== grant.workspaceId),
            {
              workspaceId: grant.workspaceId,
              ok: true,
              message: invitation
                ? 'Invitation queued. The recipient must accept it to gain access.'
                : 'Workspace access granted, or already active and unchanged.'
            }
          ])
        } catch (caught) {
          setOutcomes(previous => [
            ...previous.filter(o => o.workspaceId !== grant.workspaceId),
            {
              workspaceId: grant.workspaceId,
              ok: false,
              message: caught instanceof Error ? caught.message : 'Could not grant access'
            }
          ])
        }
      }
      setDone(true)
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add user')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      label="Add user"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form
        onSubmit={e => {
          e.preventDefault()
          void submit()
        }}
        className={`${dialogPanelClass} p-6 max-w-2xl w-full mx-4 max-h-[90dvh] overflow-y-auto space-y-4 text-gray-900`}
      >
        <fieldset disabled={busy} className="space-y-4">
          <h2 className="text-xl font-semibold">Add user</h2>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {done ? (
            <>
              <p role="status" className="text-sm">
                {accountMessage || 'Invitations processed.'}
              </p>
              <ul className="space-y-3 text-sm">
                {outcomes.map(o => (
                  <li key={o.workspaceId}>
                    <span className="font-medium">{workspaces.find(w => w.id === o.workspaceId)?.name}: </span>
                    {o.message}
                    {!o.ok && <span className="text-red-700"> · Failed</span>}
                  </li>
                ))}
              </ul>
              {createdNew && access === 'password' && (
                <div className="space-y-2">
                  <p className="text-sm text-gray-700">
                    Copy these sign-in details now. The password is shown only here and must be changed at first
                    sign-in.
                  </p>
                  <pre className="p-3 bg-gray-50 whitespace-pre-wrap">{`Email: ${normalizedEmail}\nPassword: ${password}`}</pre>
                  <button
                    type="button"
                    className={buttonClass('secondary')}
                    onClick={() =>
                      void navigator.clipboard.writeText(`Email: ${normalizedEmail}\nPassword: ${password}`)
                    }
                  >
                    Copy sign-in details
                  </button>
                </div>
              )}
              {createdNew && access === 'invite' && (
                <p className="text-sm">A password setup link has been queued by email.</p>
              )}
              <div className="flex gap-2">
                {outcomes.some(o => !o.ok) && (
                  <button disabled={busy} className={buttonClass('primary')}>
                    Retry failed grants
                  </button>
                )}
                <button type="button" disabled={busy} className={buttonClass('secondary')} onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="block text-sm">
                Email
                <input
                  required
                  type="email"
                  className={controlClass}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </label>
              {platform && existing && (
                <p role="status" className="text-sm">
                  {existing.name} already has an account. Only workspace access will be added.
                  {existing.banned ? ' This account is disabled; enable it in the user editor first.' : ''}
                </p>
              )}
              {(platform || access === 'password') && !existing && (
                <label className="block text-sm">
                  Name
                  <input required className={controlClass} value={name} onChange={e => setName(e.target.value)} />
                </label>
              )}
              <p className="text-sm text-gray-600">
                {platform
                  ? 'An existing email reuses that account without changing its profile or credentials.'
                  : mailEnabled
                    ? 'Invite by email without looking up accounts in other workspaces.'
                    : 'Email is unavailable. You can create a new account with a temporary password; a platform admin must grant access to an existing account.'}
              </p>
              <fieldset className="space-y-3">
                <legend className="font-medium text-sm">Workspace access</legend>
                {grants.map((grant, index) => (
                  <GrantRow
                    key={grant.key}
                    grant={grant}
                    workspaces={workspaces.filter(
                      w => w.status === 'active' && !grants.some(g => g.key !== grant.key && g.workspaceId === w.id)
                    )}
                    onChange={next => setGrants(previous => previous.map(g => (g.key === grant.key ? next : g)))}
                    onRemove={
                      index > 0 ? () => setGrants(previous => previous.filter(g => g.key !== grant.key)) : undefined
                    }
                  />
                ))}
                {(platform || access === 'invite') && (
                  <button
                    type="button"
                    className={buttonClass('ghost')}
                    onClick={() =>
                      setGrants(previous => [
                        ...previous,
                        { key: crypto.randomUUID(), workspaceId: '', role: 'labeller', supervisorId: '' }
                      ])
                    }
                  >
                    Add another workspace
                  </button>
                )}
              </fieldset>
              {!existing && (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">How they get in</legend>
                  {mailEnabled && (
                    <label className="block text-sm">
                      <input
                        type="radio"
                        name="access"
                        checked={access === 'invite'}
                        onChange={() => setAccess('invite')}
                      />{' '}
                      Email a link {platform ? 'to set a password' : 'to join the workspace'}
                    </label>
                  )}
                  {(platform || !mailEnabled) && (
                    <label className="block text-sm">
                      <input
                        type="radio"
                        name="access"
                        checked={access === 'password'}
                        onChange={() => setAccess('password')}
                      />{' '}
                      Show a temporary password
                    </label>
                  )}
                  {access === 'password' && (
                    <>
                      <label className="block text-sm">
                        Temporary password
                        <input
                          type="text"
                          required
                          minLength={10}
                          autoComplete="off"
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          className={controlClass}
                        />
                      </label>
                      <button
                        type="button"
                        className={buttonClass('secondary')}
                        onClick={() => setPassword(generatePassword())}
                      >
                        Generate password
                      </button>
                    </>
                  )}
                </fieldset>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className={buttonClass('secondary')} disabled={busy} onClick={onClose}>
                  Cancel
                </button>
                <button
                  className={buttonClass('primary')}
                  disabled={
                    busy || !!existing?.banned || (platform && (lookup.isFetching || lookupEmail !== normalizedEmail))
                  }
                >
                  Add user
                </button>
              </div>
            </>
          )}
        </fieldset>
      </form>
    </Modal>
  )
}
function GrantRow({
  grant,
  workspaces,
  onChange,
  onRemove
}: {
  grant: Grant
  workspaces: Workspace[]
  onChange: (grant: Grant) => void
  onRemove?: () => void
}) {
  const members = useQuery({
    queryKey: queryKeys.members(grant.workspaceId),
    enabled: !!grant.workspaceId,
    queryFn: ({ signal }) =>
      fetchJson<{ users: Array<{ id: string; name: string; role: string; status: string }> }>(
        `/api/workspaces/${grant.workspaceId}/users?includeSuspended=true`,
        { signal }
      )
  })
  return (
    <div className="border border-gray-200 p-3 grid sm:grid-cols-3 gap-3">
      <Combobox
        label="Workspace"
        value={grant.workspaceId || null}
        options={workspaces.map(w => ({ value: w.id, label: w.name }))}
        onChange={id => onChange({ ...grant, workspaceId: id ?? '', supervisorId: '' })}
      />
      <label className="text-sm">
        Workspace role
        <select
          className={controlClass}
          value={grant.role}
          onChange={e => onChange({ ...grant, role: e.target.value as Grant['role'] })}
        >
          <option value="labeller">Labeller</option>
          <option value="supervisor">Supervisor</option>
          <option value="admin">Workspace admin</option>
        </select>
      </label>
      <Combobox
        label="Supervisor"
        value={grant.supervisorId || null}
        options={(members.data?.users ?? [])
          .filter(u => u.role !== 'labeller' && u.status === 'active')
          .map(u => ({ value: u.id, label: u.name }))}
        onChange={id => onChange({ ...grant, supervisorId: id ?? '' })}
        placeholder="No supervisor"
      />
      {members.isError && (
        <p role="alert" className="text-sm text-red-700">
          Could not load supervisors.
        </p>
      )}
      {onRemove && (
        <button type="button" className={buttonClass('ghost')} onClick={onRemove}>
          Remove workspace
        </button>
      )}
    </div>
  )
}
