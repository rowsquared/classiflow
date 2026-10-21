'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/Modal'
import { workspaceApi } from '@/lib/workspace/urls'
import { csvLine } from '@/lib/csv'
import { mailStatusLabel } from '@/components/team/mail-status'

type Props = {
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
  access: string
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
  password: 'password from the file'
}

/**
 * CSV member import: preview (nothing is written), then create every member
 * in one go. Generated passwords are shown once here and can be downloaded as
 * a CSV built in the browser; the server keeps none of them.
 */
export default function MemberImportModal({ mailEnabled, onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileErrors, setFileErrors] = useState<string[]>([])
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; errors: RowError[] } | null>(null)
  const [importKey, setImportKey] = useState<string>('')
  const [result, setResult] = useState<{ importId: string; rows: ResultRow[]; replayed?: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  const send = async (dryRun: boolean) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      if (!dryRun) form.set('importKey', importKey)
      const res = await fetch(workspaceApi(`/users/import?dryRun=${dryRun}`), { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (data.fileErrors) {
        setFileErrors(data.fileErrors)
        setPreview(null)
        return
      }
      setFileErrors([])
      if (data.rows && data.errors) setPreview({ rows: data.rows, errors: data.errors })
      if (!res.ok) {
        setError(data.error || (data.errors?.length ? 'Some rows have problems; nothing was created' : 'Import failed'))
        return
      }
      if (dryRun) {
        // A new key per preview: committing this preview twice creates nothing twice.
        setImportKey(crypto.randomUUID())
      } else {
        setResult({ importId: data.importId, rows: data.rows, replayed: data.replayed })
      }
    } finally {
      setBusy(false)
    }
  }

  // Follow the mail outcomes for a short while.
  const waiting = result?.rows.some(r => r.mailStatus === 'pending' || r.mailStatus === 'sending') ?? false
  useEffect(() => {
    if (!result || !waiting) return
    let polls = 0
    const timer = setInterval(async () => {
      if (++polls > 20 || document.visibilityState !== 'visible') return
      const res = await fetch(workspaceApi(`/users/import/${result.importId}`))
      if (!res.ok) return
      const status: { rows: ResultRow[] } = await res.json()
      const byLine = new Map(status.rows.map(r => [r.line, r.mailStatus]))
      setResult(current =>
        current
          ? { ...current, rows: current.rows.map(r => ({ ...r, mailStatus: byLine.get(r.line) ?? r.mailStatus })) }
          : current
      )
    }, 3000)
    return () => clearInterval(timer)
  }, [result, waiting])

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
    URL.revokeObjectURL(url)
  }
  const close = () => (result ? onImported(`${result.rows.length} members imported`) : onClose())

  const errorsByLine = new Map<number, RowError[]>()
  for (const e of preview?.errors ?? []) errorsByLine.set(e.line, [...(errorsByLine.get(e.line) ?? []), e])

  return (
    <Modal
      label="Import members"
      onClose={close}
      className="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-50"
    >
      <div className="bg-white rounded-lg p-6 max-w-3xl w-full mx-4 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-gray-900">Import members</h2>

        {result ? (
          <>
            <p className="text-sm text-gray-700">
              {result.replayed
                ? 'This file was already imported; nothing new was created.'
                : `${result.rows.length} members created.`}
            </p>
            {generated.length > 0 && (
              <div role="alert" className="p-3 rounded bg-amber-50 text-amber-900 text-sm border border-amber-200">
                Generated passwords are shown only now. Copy or download them before closing; afterwards, send a
                password link or set a new temporary password.
              </div>
            )}
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Line</th>
                    <th className="px-3 py-2">Username</th>
                    <th className="px-3 py-2">Access</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Password</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-900">
                  {result.rows.map(r => (
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
                      await navigator.clipboard.writeText(credentialsText)
                      setCopied(true)
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    {copied ? 'Copied' : 'Copy passwords'}
                  </button>
                  <button
                    type="button"
                    onClick={downloadCredentials}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Download passwords (CSV)
                  </button>
                </>
              )}
              <button type="button" onClick={close} className="ml-auto px-4 py-2 bg-indigo-600 text-white rounded-lg">
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-700">
              One row per new member with the columns{' '}
              <code>username, email, name, role, supervisor, access, password</code>. <code>access</code> is{' '}
              <code>generate</code> (a temporary password shown here), <code>password</code> (the <code>password</code>{' '}
              column)
              {mailEnabled ? (
                <>
                  , <code>invite</code> (a link to choose a password) or <code>email_password</code> (a temporary
                  password by email)
                </>
              ) : (
                '; email is off, so invite and email_password cannot be used'
              )}
              . <code>supervisor</code> is the username of an admin or supervisor here or in the file. Existing accounts
              are never changed; at most 500 rows.
            </p>
            <a href={workspaceApi('/users/import/template')} className="text-sm text-indigo-700 underline">
              Download template
            </a>
            <div>
              <label htmlFor="member-import-file" className="block text-sm font-medium text-gray-700 mb-1">
                CSV file
              </label>
              <input
                id="member-import-file"
                type="file"
                accept=".csv,text/csv"
                onChange={e => {
                  setFile(e.target.files?.[0] ?? null)
                  setPreview(null)
                  setFileErrors([])
                  setError(null)
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
                  {preview.rows.some(r => r.role === 'admin') && ' Includes new admins.'}
                </p>
                <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-80">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                      <tr>
                        <th className="px-3 py-2">Line</th>
                        <th className="px-3 py-2">Username</th>
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
                          <td className="px-3 py-2">{r.username}</td>
                          <td className="px-3 py-2 capitalize">{r.role}</td>
                          <td className="px-3 py-2 text-gray-600">
                            {r.supervisor ??
                              (r.role === 'labeller' ? <span className="text-amber-700">none</span> : '—')}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{ACCESS_LABEL[r.access] ?? r.access}</td>
                          <td className="px-3 py-2 text-red-700">
                            {(errorsByLine.get(r.line) ?? []).map(e => `${e.field}: ${e.message}`).join('; ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700"
              >
                Cancel
              </button>
              {preview && preview.errors.length === 0 && importKey ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => send(false)}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
                >
                  Create {preview.rows.length} members
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy || !file}
                  onClick={() => send(true)}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
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
