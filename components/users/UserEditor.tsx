'use client'
import { useState, type ReactNode } from 'react'
import { queryKeys } from '@/lib/query/keys'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import Modal from '@/components/Modal'
import WorkspaceAccess from '@/components/team/WorkspaceAccess'
import Tabs from '@/components/ui/Tabs'
import { fetchJson } from '@/lib/query/fetch'
import { formatRelativeTime } from '@/lib/utils'
import { badgeClass, buttonClass, dialogPanelClass } from '@/components/ui/styles'
import { controlClass, type DirectoryUser, type Workspace } from './types'

type Section = 'workspaces' | 'profile' | 'sign-in' | 'account'
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'profile', label: 'Profile' },
  { id: 'sign-in', label: 'Sign-in' },
  { id: 'account', label: 'Account' }
]

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
        className={`${dialogPanelClass} relative mx-4 max-h-[90dvh] w-full max-w-3xl overflow-y-auto p-6 text-gray-900`}
      >
        <button
          type="button"
          aria-label="Close"
          className={buttonClass('ghost', 'sm', 'absolute right-3 top-3 px-2')}
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
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
      </div>
    </Modal>
  )
}

/** A setting with its explanation on the left and its action on the right. */
function Row({ title, children, action }: { title: string; children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-gray-200 py-4 first:pt-0 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h3 className="font-medium">{title}</h3>
        <div className="text-sm text-gray-600">{children}</div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
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
  const [section, setSection] = useState<Section>('workspaces')
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [password, setPassword] = useState('')
  const [settingPassword, setSettingPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const send = async (body: unknown, done: string, action = '', method = 'PUT') => {
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
        setSettingPassword(false)
        setMessage(done)
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
  const select = (next: Section) => {
    setSection(next)
    setError('')
    setMessage('')
  }
  const feedback = (
    <>
      {error && (
        <p role="alert" className="mb-4 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mb-4 border-l-2 border-indigo-600 bg-indigo-50 px-3 py-2 text-sm text-gray-800">
          {message}
        </p>
      )}
    </>
  )
  const access = (
    <WorkspaceAccess
      user={{ ...user, platformRole: user.role }}
      allowedWorkspaces={workspaces}
      platform={platform}
      mailEnabled={mailEnabled}
      onChanged={onChanged}
    />
  )
  const profileChanged = name.trim() !== user.name || email.trim().toLowerCase() !== user.email
  const selfNote = isSelf ? <p className="mt-1 text-xs text-gray-600">You cannot change this for yourself.</p> : null
  return (
    <div className="space-y-5">
      <header className="pr-10">
        <h2 className="text-xl font-semibold">{user.name}</h2>
        <p className="text-sm text-gray-600">{user.email}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
          {user.role === 'admin' && <span className={badgeClass('accent')}>Platform admin</span>}
          {user.banned && <span className={badgeClass('danger')}>Disabled</span>}
          {user.mustResetPassword && <span className={badgeClass('warn')}>Must change password</span>}
          <span>{user.lastLogin ? `Last sign-in ${formatRelativeTime(user.lastLogin)}` : 'Never signed in'}</span>
        </div>
      </header>
      {platform ? (
        <Tabs label="User settings" tabs={SECTIONS} selected={section} onSelect={select}>
          {feedback}
          {section === 'workspaces' && access}
          {section === 'profile' && (
            <form
              className="space-y-4"
              onSubmit={e => {
                e.preventDefault()
                void send({ name, email }, 'Profile saved.')
              }}
            >
              <p className="text-sm text-gray-600">The name and sign-in email are the same in every workspace.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm text-gray-700">
                  Name
                  <input
                    required
                    className={`${controlClass} mt-1`}
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-gray-700">
                  Email
                  <input
                    required
                    type="email"
                    className={`${controlClass} mt-1`}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                {profileChanged && (
                  <button
                    type="button"
                    className={buttonClass('ghost')}
                    disabled={busy}
                    onClick={() => {
                      setName(user.name)
                      setEmail(user.email)
                    }}
                  >
                    Cancel changes
                  </button>
                )}
                <button className={buttonClass('primary')} disabled={busy || !profileChanged}>
                  Save profile
                </button>
              </div>
            </form>
          )}
          {section === 'sign-in' && (
            <div>
              <Row
                title="Password link"
                action={
                  <button
                    className={buttonClass('secondary')}
                    disabled={busy || !mailEnabled || !!user.banned}
                    onClick={() => void send(null, `Password link sent to ${user.email}.`, '/mail', 'POST')}
                  >
                    Send password link
                  </button>
                }
              >
                Emails {user.email} a link to choose a new password.
                {!mailEnabled && ' Email is not set up on this server.'}
              </Row>
              <Row
                title="Temporary password"
                action={
                  !settingPassword && (
                    <button
                      className={buttonClass('secondary')}
                      disabled={busy}
                      onClick={() => setSettingPassword(true)}
                    >
                      Set temporary password…
                    </button>
                  )
                }
              >
                <p>A password you hand over yourself. They must change it at their next sign-in.</p>
                {settingPassword && (
                  <form
                    className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
                    onSubmit={e => {
                      e.preventDefault()
                      void send({ newPassword: password }, 'Temporary password set. All their sessions have ended.')
                    }}
                  >
                    <label className="block flex-1 text-sm text-gray-700">
                      New temporary password
                      <input
                        type="password"
                        required
                        minLength={10}
                        autoFocus
                        autoComplete="new-password"
                        className={`${controlClass} mt-1`}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={buttonClass('ghost')}
                        disabled={busy}
                        onClick={() => {
                          setSettingPassword(false)
                          setPassword('')
                        }}
                      >
                        Cancel
                      </button>
                      <button className={buttonClass('primary')} disabled={busy}>
                        Set password
                      </button>
                    </div>
                  </form>
                )}
              </Row>
              <Row
                title="Sessions"
                action={
                  <button
                    className={buttonClass('secondary')}
                    disabled={busy}
                    onClick={() => void send({ revokeSessions: true }, 'Signed out on every device.')}
                  >
                    Sign out everywhere
                  </button>
                }
              >
                Ends every open session; they have to sign in again.
              </Row>
            </div>
          )}
          {section === 'account' && (
            <div>
              <Row
                title="Platform administrator"
                action={
                  <>
                    <button
                      className={buttonClass('secondary')}
                      disabled={busy || isSelf}
                      onClick={() =>
                        void send(
                          { platformRole: user.role === 'admin' ? 'user' : 'admin' },
                          user.role === 'admin' ? 'Platform admin role removed.' : 'Now a platform administrator.'
                        )
                      }
                    >
                      {user.role === 'admin' ? 'Remove platform admin' : 'Make platform admin'}
                    </button>
                    {selfNote}
                  </>
                }
              >
                {user.role === 'admin'
                  ? 'Yes: admin in every workspace, including new ones, and manages users and workspaces.'
                  : 'No. Platform administrators are admin in every workspace and manage users and workspaces.'}
              </Row>
              <Row
                title="Account status"
                action={
                  <>
                    <button
                      className={buttonClass('secondary')}
                      disabled={busy || isSelf}
                      onClick={() =>
                        void send(
                          { banned: !user.banned },
                          user.banned ? 'Account enabled.' : 'Account disabled; they have been signed out.'
                        )
                      }
                    >
                      {user.banned ? 'Enable account' : 'Disable account'}
                    </button>
                    {selfNote}
                  </>
                }
              >
                {user.banned
                  ? 'Disabled: cannot sign in. Saved work is kept.'
                  : 'Enabled. Disabling blocks sign-in and ends their sessions; saved work is kept.'}
              </Row>
              <Row
                title="Delete user"
                action={
                  <button
                    className={buttonClass('secondary', 'md', 'text-red-700')}
                    disabled={busy || isSelf || !!deletionBlocker}
                    onClick={() => setDeleting(true)}
                  >
                    Delete user…
                  </button>
                }
              >
                {deletionBlocker ??
                  'Permanently deletes the account. Only possible without saved work or workspace access.'}
              </Row>
            </div>
          )}
        </Tabs>
      ) : (
        <section className="space-y-3">
          <h3 className="font-medium">Workspace access</h3>
          {feedback}
          {access}
          <p className="text-xs text-gray-600">Name, email and sign-in are managed by platform administrators.</p>
        </section>
      )}
      {deleting && (
        <Modal
          label="Delete user permanently"
          onClose={() => {
            if (!busy) setDeleting(false)
          }}
        >
          <div className={`${dialogPanelClass} max-w-md space-y-4 p-6`}>
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
            <div className="flex justify-end gap-2">
              <button disabled={busy} className={buttonClass('secondary')} onClick={() => setDeleting(false)}>
                Cancel
              </button>
              <button
                disabled={busy || confirmName !== user.email}
                className={buttonClass('danger')}
                onClick={() => void send(null, '', '', 'DELETE')}
              >
                Delete user
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
