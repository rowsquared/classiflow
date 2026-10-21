'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AuthCard, {
  authButton,
  authInput,
  forgetLinkToken,
  removeLinkFromAddress,
  takeLinkToken
} from '@/components/AuthCard'

const STORAGE_KEY = 'classiflow.password-link'

type State =
  | { step: 'checking' }
  | { step: 'invalid' }
  | { step: 'form'; username: string; purpose: 'invitation' | 'password_link' }
  | { step: 'done'; username: string }

/**
 * Choosing a password from an invitation or password link (signed out). The
 * token comes in the address fragment, so it never reaches a server log;
 * opening the page only checks it, and only submitting the form uses it.
 */
export default function SetPasswordPage() {
  const [token] = useState(() => (typeof window === 'undefined' ? '' : takeLinkToken(STORAGE_KEY)))
  const [state, setState] = useState<State>({ step: 'checking' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    removeLinkFromAddress()
    let active = true
    const check = async () => {
      const res = token
        ? await fetch('/api/auth/set-password/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          }).catch(() => null)
        : null
      const data = res?.ok ? await res.json() : null
      if (active)
        setState(data ? { step: 'form', username: data.username, purpose: data.purpose } : { step: 'invalid' })
    }
    void check()
    return () => {
      active = false
    }
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (state.step !== 'form') return
    setError(null)
    if (password !== confirm) {
      setError('The passwords do not match')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/set-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not set the password')
        return
      }
      forgetLinkToken(STORAGE_KEY)
      setState({ step: 'done', username: data.username })
    } finally {
      setBusy(false)
    }
  }

  if (state.step === 'checking') {
    return (
      <AuthCard title="Choose a password">
        <p className="text-sm text-gray-600 text-center">Checking the link…</p>
      </AuthCard>
    )
  }
  if (state.step === 'invalid') {
    return (
      <AuthCard title="This link does not work">
        <p className="text-sm text-gray-700 mb-4">
          It may have expired, been used already, or been replaced by a newer one. Ask for a new password link, or ask
          your admin for a new invitation.
        </p>
        <Link href="/login" className="block text-center text-sm text-indigo-700 hover:underline">
          Back to sign in
        </Link>
      </AuthCard>
    )
  }
  if (state.step === 'done') {
    return (
      <AuthCard title="Password saved">
        <p role="status" className="text-sm text-gray-700 mb-4">
          You can now sign in as <strong>{state.username}</strong> with your new password.
        </p>
        <Link href="/login" className={`${authButton} block text-center`}>
          Sign in
        </Link>
      </AuthCard>
    )
  }
  return (
    <AuthCard
      title={state.purpose === 'invitation' ? 'Welcome to classiflow' : 'Choose a new password'}
      subtitle={`For the account ${state.username}`}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={authInput}
          />
          <p className="mt-1 text-xs text-gray-500">At least 10 characters, not your username or name</p>
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
            Repeat the password
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className={authInput}
          />
        </div>
        <button type="submit" disabled={busy} className={authButton}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </AuthCard>
  )
}
