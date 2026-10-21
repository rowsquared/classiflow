import type { ReactNode } from 'react'
import Image from 'next/image'

/** The centred card of the signed-out pages (forgotten password, links, invitations). */
export default function AuthCard({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 overflow-y-auto">
      <main className="w-full max-w-md bg-white rounded-lg shadow-lg p-8">
        <div className="flex justify-center mb-6">
          <Image src="/logo.svg" alt="classiflow" width={120} height={32} className="h-8 w-auto" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">{title}</h1>
        {subtitle && <p className="text-sm text-gray-600 mb-6 text-center">{subtitle}</p>}
        {children}
      </main>
    </div>
  )
}

export const authInput =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900'

export const authButton =
  'w-full bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:bg-indigo-300 disabled:cursor-not-allowed'

/**
 * The token of a link (`#t=...` in the address), kept in this tab's
 * sessionStorage so a reload still works once removeLinkFromAddress() has
 * taken it out of the address bar. Browser only.
 */
export function takeLinkToken(key: string): string {
  const match = /[#&]t=([A-Za-z0-9_.-]+)/.exec(window.location.hash)
  try {
    if (match) {
      sessionStorage.setItem(key, match[1]!)
      return match[1]!
    }
    return sessionStorage.getItem(key) ?? ''
  } catch {
    return match?.[1] ?? ''
  }
}

/** Takes the token out of the address bar and the history (call from an effect). */
export function removeLinkFromAddress() {
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
}

export function forgetLinkToken(key: string) {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Storage unavailable: nothing to forget.
  }
}
