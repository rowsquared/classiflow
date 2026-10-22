'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { buttonClass } from '@/components/ui/styles'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (newPassword.length < 10) {
      setError('Password must be at least 10 characters long')
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to reset password')
        setLoading(false)
        return
      }

      // This browser's session stays signed in; the server ended all others.
      router.push('/')
      router.refresh()
    } catch (error) {
      console.error('Password reset error:', error)
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-8">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <Image src="/logo.svg" alt="classiflow Logo" width={120} height={32} className="h-8 w-auto" />
        </div>

        {/* Heading */}
        <h2 className="text-2xl font-semibold text-gray-900 mb-2 text-center">Password reset required</h2>
        <p className="text-sm text-gray-600 mb-6 text-center">Please set a new password to continue</p>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
        )}

        {/* Reset form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-1">
              Current password
            </label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-500 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-transparent text-gray-900"
            />
          </div>

          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={10}
              className="w-full px-3 py-2 border border-gray-500 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-transparent text-gray-900"
            />
            <p className="mt-1 text-xs text-gray-500">At least 10 characters, not your username or name</p>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              minLength={10}
              className="w-full px-3 py-2 border border-gray-500 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-transparent text-gray-900"
            />
          </div>

          <button type="submit" disabled={loading} className={buttonClass('primary', 'md', 'w-full mt-6')}>
            {loading ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
      </div>
    </div>
  )
}
