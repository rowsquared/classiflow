import type { ReactNode } from 'react'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import Sidebar from '@/components/Sidebar'
import QueryProvider from '@/components/QueryProvider'
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher'
import { WorkspaceProvider } from '@/components/WorkspaceProvider'
import { preferredWorkspace } from '@/lib/server/preferred-workspace'
import type { SessionUser } from '@/lib/api-auth'

export default async function GlobalShell({
  scopeKey,
  user,
  children
}: {
  scopeKey: string
  user: SessionUser
  children: ReactNode
}) {
  const workspace = await preferredWorkspace(user)
  const navigation = workspace
    ? {
        id: workspace.id,
        name: workspace.name,
        role: workspace.role,
        authority: workspace.authority,
        archived: false
      }
    : null
  return (
    <WorkspaceProvider value={navigation} userId={user.id} remember={false}>
      <QueryProvider key={`${scopeKey}:${workspace?.id ?? ''}:${workspace?.role ?? ''}`}>
        <NuqsAdapter>
          <div className="flex h-dvh overflow-hidden">
            <Sidebar />
            <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-white">
              <div className="sticky top-0 z-10 flex h-[66px] items-center justify-end border-b border-gray-200 bg-white px-8">
                <WorkspaceSwitcher />
              </div>
              {children}
            </main>
          </div>
        </NuqsAdapter>
      </QueryProvider>
    </WorkspaceProvider>
  )
}
