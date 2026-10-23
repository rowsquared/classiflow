'use client'
import { useState } from 'react'
import { queryKeys } from '@/lib/query/keys'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import Modal from '@/components/Modal'
import WorkspaceAccess from '@/components/team/WorkspaceAccess'
import { fetchJson } from '@/lib/query/fetch'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'
import { controlClass, type DirectoryUser, type Workspace } from './types'

export default function UserEditor({
  userId,
  currentUserId,
  platform,
  workspaces,
  mailEnabled,
  onClose,
  onChanged
}: {
  userId: string
  currentUserId: string
  platform: boolean
  workspaces: Workspace[]
  mailEnabled: boolean
  onClose: () => void
  onChanged: () => Promise<unknown>
}) {
  const query = useQuery({
    queryKey: queryKeys.directoryUser(userId),
    queryFn: ({ signal }) =>
      fetchJson<{ user: DirectoryUser; deletionBlocker: string | null }>(`/api/user-directory/${userId}`, { signal })
  })
  return (
    <Modal label="Edit user" onClose={onClose}>
      <div
        className={`${dialogPanelClass} p-6 max-w-3xl w-full mx-4 max-h-[90dvh] overflow-y-auto space-y-5 text-gray-900`}
      >
        {query.isPending && <p role="status">Loading user…</p>}
        {query.isError && <p role="alert">Could not load this user.</p>}
        {query.data && (
          <Editor
            key={query.data.user.id}
            user={query.data.user}
            deletionBlocker={query.data.deletionBlocker}
            isSelf={userId === currentUserId}
            platform={platform}
            workspaces={workspaces}
            mailEnabled={mailEnabled}
            onClose={onClose}
            onChanged={onChanged}
          />
        )}
        <button className={buttonClass('secondary')} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
function Editor({
  user,
  deletionBlocker,
  isSelf,
  platform,
  workspaces,
  mailEnabled,
  onClose,
  onChanged
}: {
  user: DirectoryUser
  deletionBlocker: string | null
  isSelf: boolean
  platform: boolean
  workspaces: Workspace[]
  mailEnabled: boolean
  onClose: () => void
  onChanged: () => Promise<unknown>
}) {
  const router = useRouter()
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const send = async (body: unknown, action = '', method = 'PUT') => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await fetchJson(`/api/users/${user.id}${action}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (method === 'DELETE') {
        onClose()
        await onChanged()
      } else {
        setPassword('')
        setMessage('Saved.')
        if (isSelf && body && typeof body === 'object' && ('revokeSessions' in body || 'newPassword' in body)) {
          router.replace('/login')
          router.refresh()
        } else await onChanged()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save user')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div>
        <h2 className="text-xl font-semibold">{user.name}</h2>
        <p className="text-sm text-gray-600">
          {user.email} · Sign-in alias: {user.username}
        </p>
        <p className="text-sm text-gray-600">
          Last sign-in: {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-gray-700">
          {message}
        </p>
      )}
      <section className="space-y-3">
        <h3 className="font-medium">
          Profile <span className="text-sm text-gray-600">· applies in every workspace</span>
        </h3>
        {platform ? (
          <form
            className="space-y-3"
            onSubmit={e => {
              e.preventDefault()
              void send({ name, email })
            }}
          >
            <label className="block text-sm">
              Name
              <input required className={controlClass} value={name} onChange={e => setName(e.target.value)} />
            </label>
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
            <button className={buttonClass('secondary')} disabled={busy}>
              Save profile
            </button>
          </form>
        ) : (
          <p className="text-sm text-gray-600">Profile and sign-in settings are managed by platform administrators.</p>
        )}
      </section>
      <WorkspaceAccess
        user={{ ...user, platformRole: user.role }}
        allowedWorkspaces={workspaces}
        platform={platform}
        mailEnabled={mailEnabled}
        onChanged={onChanged}
      />
      {platform && (
        <>
          <section className="space-y-3">
            <h3 className="font-medium">Sign-in</h3>
            <p className="text-sm text-gray-600">These actions apply to the account in every workspace.</p>
            <div className="flex flex-wrap gap-2">
              <button
                className={buttonClass('secondary')}
                disabled={busy || !mailEnabled || !!user.banned}
                onClick={() => void send(null, '/mail', 'POST')}
              >
                Send password link
              </button>
              <button
                className={buttonClass('secondary')}
                disabled={busy}
                onClick={() => void send({ revokeSessions: true })}
              >
                Sign out everywhere
              </button>
            </div>
            <form
              className="space-y-2"
              onSubmit={e => {
                e.preventDefault()
                void send({ newPassword: password })
              }}
            >
              <label className="block text-sm">
                New temporary password
                <input
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  className={controlClass}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </label>
              <p className="text-sm text-gray-600">Ends all sessions and requires a password change at next sign-in.</p>
              <button className={buttonClass('secondary')} disabled={busy}>
                Set temporary password
              </button>
            </form>
          </section>
          <section className="space-y-3 border-t border-gray-200 pt-4">
            <h3 className="font-medium">Platform</h3>
            <label className="block text-sm">
              <input
                type="checkbox"
                checked={user.role === 'admin'}
                disabled={busy || isSelf}
                onChange={e => void send({ platformRole: e.target.checked ? 'admin' : 'user' })}
              />{' '}
              Platform administrator — admin in every workspace, now and later
            </label>
            <label className="block text-sm">
              <input
                type="checkbox"
                checked={!user.banned}
                disabled={busy || isSelf}
                onChange={e => void send({ banned: !e.target.checked })}
              />{' '}
              Account enabled — disabling blocks sign-in and ends sessions; saved work is kept
            </label>
          </section>
          <section className="space-y-2 border-t border-gray-200 pt-4">
            <h3 className="font-medium">Delete user</h3>
            <p className="text-sm text-gray-600">
              {deletionBlocker ?? 'Only accounts without saved work or active workspace access can be deleted.'}
            </p>
            <button
              className={buttonClass('secondary')}
              disabled={busy || isSelf || !!deletionBlocker}
              onClick={() => setDeleting(true)}
            >
              Delete user…
            </button>
          </section>
        </>
      )}
      {deleting && (
        <Modal
          label="Delete user permanently"
          onClose={() => {
            if (!busy) setDeleting(false)
          }}
        >
          <div className={`${dialogPanelClass} p-6 max-w-md space-y-4`}>
            <h3 className="text-lg font-medium">Delete user permanently</h3>
            <p>This deletes {user.email} and their sign-in credentials. This cannot be undone.</p>
            <label className="block text-sm">
              Type {user.email} to confirm
              <input className={controlClass} value={confirmName} onChange={e => setConfirmName(e.target.value)} />
            </label>
            {error && (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button disabled={busy} className={buttonClass('secondary')} onClick={() => setDeleting(false)}>
                Cancel
              </button>
              <button
                disabled={busy || confirmName !== user.email}
                className={buttonClass('danger')}
                onClick={() => void send(null, '', 'DELETE')}
              >
                Delete user
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
