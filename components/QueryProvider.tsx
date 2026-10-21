'use client'

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { shouldRetry } from '@/lib/query/fetch'

/**
 * One TanStack Query cache per workspace page tree. app/w/[workspaceId]/layout.tsx
 * keys this provider by workspace, user and role, so switching workspaces,
 * signing in as someone else or a role change starts with an empty cache
 * instead of showing data fetched under another scope. Nothing is persisted.
 */
export default function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Server-rendered initial data counts as fresh for 30 s, so mounting
            // a page does not repeat the request the server just made.
            staleTime: 30_000,
            retry: shouldRetry
          }
        }
      })
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
