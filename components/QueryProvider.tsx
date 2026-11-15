'use client'

import { useState, type ReactNode } from 'react'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fetchJson, HttpError, shouldRetry } from '@/lib/query/fetch'
import Modal from '@/components/Modal'
import { buttonClass, dialogPanelClass } from '@/components/ui/styles'

/**
 * One TanStack Query cache per workspace page tree. app/w/[workspaceId]/layout.tsx
 * keys this provider by workspace, user and role, so switching workspaces,
 * signing in as someone else or a role change starts with an empty cache
 * instead of showing data fetched under another scope. Nothing is persisted.
 */
export default function QueryProvider({ children, userId }: { children: ReactNode; userId?: string }) {
  const [signInUrl, setSignInUrl] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [client] = useState(() => {
    const onError = (error: unknown) => {
      if (!userId || !(error instanceof HttpError) || error.status !== 401) return
      const { pathname, search } = window.location
      setSignInUrl(`/login?${new URLSearchParams({ next: pathname + search })}`)
    }
    return new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: {
          // Server-rendered initial data counts as fresh for 30 s, so mounting
          // a page does not repeat the request the server just made.
          staleTime: 30_000,
          retry: shouldRetry
        }
      }
    })
  })

  async function resume() {
    setChecking(true)
    setProblem(null)
    try {
      const current = await fetchJson<{ user: { id: string } } | null>('/api/auth/get-session', { cache: 'no-store' })
      if (current?.user.id !== userId) {
        setProblem('Sign in with the account you were using in this tab.')
        return
      }
      await client.invalidateQueries({}, { throwOnError: true })
      setSignInUrl(null)
    } catch {
      setProblem('Could not check your session. Try again.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <QueryClientProvider client={client}>
      <div className="contents" inert={Boolean(signInUrl)}>
        {children}
      </div>
      {signInUrl && (
        <Modal
          label="Your session has ended"
          onClose={() => {}}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
        >
          <div className={`${dialogPanelClass} w-full max-w-md space-y-4 p-6`}>
            <h2 className="text-xl font-semibold">Your session has ended</h2>
            <p className="text-sm text-gray-700">
              Sign in in a new tab, then return here to continue with your current work.
            </p>
            {problem && (
              <p role="alert" className="text-sm text-red-700">
                {problem}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <a href={signInUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('primary')}>
                Sign in in a new tab
              </a>
              <button type="button" onClick={resume} disabled={checking} className={buttonClass('secondary')}>
                Continue
              </button>
            </div>
          </div>
        </Modal>
      )}
    </QueryClientProvider>
  )
}
