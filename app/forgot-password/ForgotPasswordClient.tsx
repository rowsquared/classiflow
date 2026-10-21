'use client'

import { useState } from 'react'
import Link from 'next/link'
import AuthCard, { authButton, authInput } from '@/components/AuthCard'

export default function ForgotPasswordClient() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setError(data.error || 'Something went wrong. Please try again.')
      else setMessage(data.message)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title="Forgot your password?" subtitle="We email a link to choose a new one.">
      {message ? (
        <div className="space-y-4">
          <p role="status" className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-900 text-sm">
            {message} Check your inbox; the link works for a limited time and only once.
          </p>
          <Link href="/login" className="block text-center text-sm text-indigo-700 hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="forgot-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email address of your account
            </label>
            <input
              id="forgot-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={authInput}
            />
          </div>
          <button type="submit" disabled={busy} className={authButton}>
            {busy ? 'Sending…' : 'Send link'}
          </button>
          <Link href="/login" className="block text-center text-sm text-indigo-700 hover:underline">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthCard>
  )
}
