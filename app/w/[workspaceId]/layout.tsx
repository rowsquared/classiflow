import type { ReactNode } from 'react'
import Sidebar from '@/components/Sidebar'
import { WorkspaceProvider } from '@/components/WorkspaceProvider'
import QueryProvider from '@/components/QueryProvider'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { prisma } from '@/lib/prisma'
import { requirePageUser } from '@/lib/server/page-user'
import { touchLastSeen } from '@/lib/last-seen'

// Every page under /w/[workspaceId] runs inside this workspace: the access
// check happens here on each request (404 for a workspace the user may not
// enter), and the client components read it from WorkspaceProvider. Keyed by
// workspace, so switching workspaces remounts all workspace state; the query
// cache is also keyed by user and role, so it never outlives the scope its
// data was fetched under.
export default async function WorkspaceLayout({
  children,
  params
}: {
  children: ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const user = await requirePageUser(workspaceId)
  if (user.membershipId) await touchLastSeen(user.membershipId)
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } })

  return (
    <WorkspaceProvider
      key={workspaceId}
      value={{
        id: workspaceId,
        name: workspace.name,
        role: user.role,
        authority: user.authority,
        archived: user.archived
      }}
    >
      <QueryProvider key={`${workspaceId}:${user.id}:${user.role}`}>
        <NuqsAdapter>
          <div className="flex h-dvh overflow-hidden">
            <Sidebar />
            <main className="flex-1 min-w-0 min-h-0 overflow-auto bg-white">
              {user.archived && (
                <div role="status" className="px-8 py-2 text-sm bg-amber-50 text-amber-900 border-b border-amber-200">
                  This workspace is archived and read-only.
                </div>
              )}
              {children}
            </main>
          </div>
        </NuqsAdapter>
      </QueryProvider>
    </WorkspaceProvider>
  )
}
