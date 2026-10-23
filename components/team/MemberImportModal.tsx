'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { fetchJson } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import Modal from '@/components/Modal'
import { csvLine } from '@/lib/csv'
import { mailStatusLabel } from '@/components/team/mail-status'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'

type Props = {
  workspaceId?: string
  mailEnabled: boolean
  onClose: () => void
  /** Called when the person closes the result. */
  onImported: (message: string) => void
}

type PreviewRow = {
  line: number
  username: string
  email: string
  name: string
  role: string
  supervisor: string | null
  access: string | null
  outcome: 'create' | 'add' | 'restore' | 'unchanged' | 'invitation'
  note: string | null
}
type RowError = { line: number; field: string; message: string }
type ResultRow = {
  line: number
  username: string
  userId: string | null
  access: string
  mailStatus: string | null
  password?: string
}

const ACCESS_LABEL: Record<string, string> = {
  invite: 'invitation link by email',
  email_password: 'temporary password by email',
  generate: 'temporary password shown here',
  password: 'password from the file',
  add: 'existing account added',
  restore: 'access restored',
  unchanged: 'already a member, unchanged',
  invitation: 'invitation to the workspace by email'
}

const OUTCOME_LABEL: Record<PreviewRow['outcome'], string> = {
  create: 'New account',
  add: 'Add existing account',
  restore: 'Restore access',
  unchanged: 'No change',
  invitation: 'Invite'
}

/**
 * CSV member import: preview each row's outcome (nothing is written), then
 * apply every row in one go. Rows whose email has an account reuse it. Generated passwords are shown once here and can be downloaded as
 * a CSV built in the browser; the server keeps none of them.
 */
export default function MemberImportModal({
  workspaceId: explicitWorkspaceId,
  mailEnabled,
  onClose,
  onImported
}: Props) {
  const paths = useWorkspacePaths()
  const workspaceId = explicitWorkspaceId ?? paths.workspaceId
  const api = (path: string) => `/api/workspaces/${workspaceId}${path}`
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileErrors, setFileErrors] = useState<string[]>([])
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; errors: RowError[] } | null>(null)
  const [importKey, setImportKey] = useState<string>('')
  const [result, setResult] = useState<{ importId: string; rows: ResultRow[]; replayed?: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

  const send = async (dryRun: boolean) => {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      if (!dryRun) form.set('importKey', importKey)
      if (!dryRun && confirmRestore) form.set('confirmRestore', 'true')
      const res = await fetch(api(`/users/import?dryRun=${dryRun}`), { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (data.fileErrors) {
        setFileErrors(data.fileErrors)
        setPreview(null)
        return
      }
      setFileErrors([])
      if (data.rows && data.errors) setPreview({ rows: data.rows, errors: data.errors })
      if (!res.ok) {
        setError(data.error || (data.errors?.length ? 'Some rows have problems; nothing was changed' : 'Import failed'))
        return
      }
      if (dryRun) {
        // A new key per preview: committing this preview twice creates nothing twice.
        setImportKey(crypto.randomUUID())
      } else {
        setResult({ importId: data.importId, rows: data.rows, replayed: data.replayed })
      }
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // Poll outcomes without replacing the one-time passwords in the import response.
  const outcomes = useQuery({
    queryKey: [...queryKeys.members(workspaceId), 'import', result?.importId],
    queryFn: ({ signal }) => fetchJson<{ rows: ResultRow[] }>(api(`/users/import/${result!.importId}`), { signal }),
    enabled: !!result && result.rows.some(r => r.mailStatus === 'pending' || r.mailStatus === 'sending'),
    refetchInterval: query => {
      const rows = query.state.data?.rows ?? result?.rows ?? []
      return rows.some(r => r.mailStatus === 'pending' || r.mailStatus === 'sending') ? 3000 : false
    }
  })
  const mailByLine = new Map(outcomes.data?.rows.map(r => [r.line, r.mailStatus]))
  const resultRows = result?.rows.map(r => ({ ...r, mailStatus: mailByLine.get(r.line) ?? r.mailStatus })) ?? []
  const generated = result?.rows.filter(r => r.password) ?? []
  const credentialsText = generated.map(r => `${r.username}\t${r.password}`).join('\n')
  const downloadCredentials = () => {
    const columns = [{ header: 'username' }, { header: 'password' }]
    const csv = [
      'username,password',
      ...generated.map(r => csvLine(columns, [r.username, r.password!], { neutralizeFormulas: false }))
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'new-member-passwords.csv'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  const close = () => {
    if (!busy) {
      if (result) onImported(`${result.rows.length} ${result.rows.length === 1 ? 'row' : 'rows'} imported`)
      else onClose()
    }
  }

  const restoring = preview?.rows.filter(r => r.outcome === 'restore').length ?? 0
  const errorsByLine = new Map<number, RowError[]>()
  for (const e of preview?.errors ?? []) errorsByLine.set(e.line, [...(errorsByLine.get(e.line) ?? []), e])

  return (
    <Modal label="Import members" onClose={close}>
      <div className={`${dialogPanelClass} p-6 max-w-3xl w-full mx-4 space-y-4 max-h-[90vh] overflow-y-auto`}>
        <h2 className="text-xl font-semibold text-gray-900">Import members</h2>

        {result ? (
          <>
            <p className="text-sm text-gray-700">
              {result.replayed
                ? 'This file was already imported; nothing new was created.'
                : `${result.rows.length} ${result.rows.length === 1 ? 'row' : 'rows'} imported.`}
            </p>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            {generated.length > 0 && (
              <div role="alert" className="p-3 rounded bg-amber-50 text-amber-900 text-sm border border-amber-200">
                Generated passwords are shown only now. Copy or download them before closing; afterwards, send a
                password link or set a new temporary password.
              </div>
            )}
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Line</th>
                    <th className="px-3 py-2">Username or email</th>
                    <th className="px-3 py-2">Result</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Password</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-900">
                  {resultRows.map(r => (
                    <tr key={r.line}>
                      <td className="px-3 py-2 text-gray-500">{r.line}</td>
                      <td className="px-3 py-2">{r.username}</td>
                      <td className="px-3 py-2 text-gray-600">{ACCESS_LABEL[r.access] ?? r.access}</td>
                      <td className="px-3 py-2 text-gray-600">{r.mailStatus ? mailStatusLabel(r.mailStatus) : '—'}</td>
                      <td className="px-3 py-2 font-mono">{r.password ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-3">
              {generated.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(credentialsText)
                        setCopied(true)
                      } catch {
                        setError('Could not copy passwords. Download the CSV instead.')
                      }
                    }}
                    className={buttonClass('secondary')}
                  >
                    {copied ? 'Copied' : 'Copy passwords'}
                  </button>
                  <button type="button" onClick={downloadCredentials} className={buttonClass('secondary')}>
                    Download passwords (CSV)
                  </button>
                </>
              )}
              <button type="button" onClick={close} className={buttonClass('primary', 'md', 'ml-auto')}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-700">
              One row per person with the columns <code>username, email, name, role, supervisor, access, password</code>
              . If the email already has an account, that account is reused: leave <code>username</code>,{' '}
              <code>name</code>, <code>access</code> and <code>password</code> empty; its profile and password are not
              changed. For new accounts, <code>access</code> is <code>generate</code> (a temporary password shown here),{' '}
              <code>password</code> (the <code>password</code> column)
              {mailEnabled ? (
                <>
                  , <code>invite</code> (a link to choose a password) or <code>email_password</code> (a temporary
                  password by email)
                </>
              ) : (
                '; email is off, so invite and email_password cannot be used'
              )}
              . <code>supervisor</code> is the username of an admin or supervisor here or in the file. Members already
              here keep their role; at most 500 rows.
            </p>
            <a href={api('/users/import/template')} className="text-sm text-indigo-700 underline">
              Download template
            </a>
            <div>
              <label htmlFor="member-import-file" className="block text-sm font-medium text-gray-700 mb-1">
                CSV file
              </label>
              <input
                disabled={busy}
                id="member-import-file"
                type="file"
                accept=".csv,text/csv"
                onChange={e => {
                  setFile(e.target.files?.[0] ?? null)
                  setPreview(null)
                  setFileErrors([])
                  setError(null)
                  setConfirmRestore(false)
                }}
                className="text-sm text-gray-700"
              />
            </div>

            {error && (
              <div role="alert" className="p-3 rounded bg-red-50 text-red-700 text-sm border border-red-200">
                {error}
              </div>
            )}
            {fileErrors.length > 0 && (
              <ul
                role="alert"
                className="p-3 rounded bg-red-50 text-red-700 text-sm border border-red-200 list-disc pl-6"
              >
                {fileErrors.map(e => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}

            {preview && (
              <div className="space-y-2">
                <p className="text-sm text-gray-700">
                  {preview.rows.length} rows,{' '}
                  {preview.errors.length === 0 ? 'no problems' : `${errorsByLine.size} with problems`}.
                  {preview.rows.some(r => r.role === 'admin' && r.outcome !== 'unchanged') && ' Includes new admins.'}
                </p>
                <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-80">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs text-gray-500">
                      <tr>
                        <th className="px-3 py-2">Line</th>
                        <th className="px-3 py-2">Person</th>
                        <th className="px-3 py-2">Outcome</th>
                        <th className="px-3 py-2">Role</th>
                        <th className="px-3 py-2">Supervisor</th>
                        <th className="px-3 py-2">Access</th>
                        <th className="px-3 py-2">Problems</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-900">
                      {preview.rows.map(r => (
                        <tr key={r.line} className={errorsByLine.has(r.line) ? 'bg-red-50' : ''}>
                          <td className="px-3 py-2 text-gray-500">{r.line}</td>
                          <td className="px-3 py-2">{r.username || r.email}</td>
                          <td className="px-3 py-2">
                            {OUTCOME_LABEL[r.outcome]}
                            {r.note && <span className="block text-xs text-gray-600">{r.note}</span>}
                          </td>
                          <td className="px-3 py-2 capitalize">{r.role}</td>
                          <td className="px-3 py-2 text-gray-600">
                            {r.supervisor ??
                              (r.role === 'labeller' ? <span className="text-amber-700">none</span> : '—')}
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {r.outcome === 'create' && r.access ? (ACCESS_LABEL[r.access] ?? r.access) : '—'}
                          </td>
                          <td className="px-3 py-2 text-red-700">
                            {(errorsByLine.get(r.line) ?? []).map(e => `${e.field}: ${e.message}`).join('; ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {restoring > 0 && preview.errors.length === 0 && (
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={confirmRestore}
                      onChange={e => setConfirmRestore(e.target.checked)}
                    />
                    Restore access for {restoring} removed {restoring === 1 ? 'member' : 'members'}, with the role in
                    the file
                  </label>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={close}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700"
              >
                Cancel
              </button>
              {preview && preview.errors.length === 0 && importKey ? (
                <button
                  type="button"
                  disabled={busy || (restoring > 0 && !confirmRestore)}
                  onClick={() => send(false)}
                  className={buttonClass('primary', 'md', 'flex-1')}
                >
                  Import {preview.rows.length} {preview.rows.length === 1 ? 'row' : 'rows'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy || !file}
                  onClick={() => send(true)}
                  className={buttonClass('primary', 'md', 'flex-1')}
                >
                  Preview
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
