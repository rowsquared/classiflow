'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AuthCard, { authButton, forgetLinkToken, removeLinkFromAddress, takeLinkToken } from '@/components/AuthCard'

const STORAGE_KEY = 'classiflow.invitation'

type Check = {
  workspaceName: string
  role: string
  archived: boolean
  matchesAccount: boolean | null
  signedIn: boolean
}

/**
 * Accepting a workspace invitation. Works signed out: the page explains the
 * invitation and sends the person to sign in with the invited address (the
 * token waits in this tab's sessionStorage), then back here to accept.
 */
export default function InvitationPage() {
  const router = useRouter()
  const [token] = useState(() => (typeof window === 'undefined' ? '' : takeLinkToken(STORAGE_KEY)))
  const [check, setCheck] = useState<Check | 'checking' | 'invalid'>('checking')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    removeLinkFromAddress()
    let active = true
    const load = async () => {
      const res = token
        ? await fetch('/api/invitations/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          }).catch(() => null)
        : null
      const data = res?.ok ? ((await res.json()) as Check) : null
      if (active) setCheck(data ?? 'invalid')
    }
    void load()
    return () => {
      active = false
    }
  }, [token])

  const accept = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'The invitation could not be accepted')
        return
      }
      forgetLinkToken(STORAGE_KEY)
      router.push(`/w/${data.workspaceId}/queue`)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (check === 'checking') {
    return (
      <AuthCard title="Workspace invitation">
        <p className="text-sm text-gray-600 text-center">Checking the invitation…</p>
      </AuthCard>
    )
  }
  if (check === 'invalid') {
    return (
      <AuthCard title="This invitation does not work">
        <p className="text-sm text-gray-700 mb-4">
          It may have expired, been withdrawn, used already, or replaced by a newer one. Ask the person who invited you
          to send it again.
        </p>
        <Link href="/" className="block text-center text-sm text-indigo-700 hover:underline">
          Go to classiflow
        </Link>
      </AuthCard>
    )
  }
  return (
    <AuthCard title="Workspace invitation" subtitle={`Join “${check.workspaceName}” as ${check.role}.`}>
      {error && (
        <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {error}
        </div>
      )}
      {check.archived ? (
        <p className="text-sm text-gray-700">This workspace is archived, so the invitation cannot be accepted now.</p>
      ) : !check.signedIn ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Sign in with the classiflow account that uses the email address this invitation was sent to, then accept it
            here.
          </p>
          <Link href="/login?next=/invitation" className={`${authButton} block text-center`}>
            Sign in to accept
          </Link>
        </div>
      ) : check.matchesAccount ? (
        <button type="button" disabled={busy} onClick={accept} className={authButton}>
          {busy ? 'Joining…' : 'Accept and open the workspace'}
        </button>
      ) : (
        <p className="text-sm text-gray-700">
          This invitation was sent to a different email address than the one of the account you are signed in with. Sign
          out and sign in with the invited account to accept it.
        </p>
      )}
    </AuthCard>
  )
}
