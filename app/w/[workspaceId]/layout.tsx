import type { ReactNode } from 'react'
import Sidebar from '@/components/Sidebar'
import { WorkspaceProvider } from '@/components/WorkspaceProvider'
import { prisma } from '@/lib/prisma'
import { requirePageUser } from '@/lib/server/page-user'
import { touchLastSeen } from '@/lib/last-seen'

// Every page under /w/[workspaceId] runs inside this workspace: the access
// check happens here on each request (404 for a workspace the user may not
// enter), and the client components read it from WorkspaceProvider. Keyed by
// workspace, so switching workspaces remounts all workspace state.
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
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto bg-white">
          {user.archived && (
            <div role="status" className="px-8 py-2 text-sm bg-amber-50 text-amber-900 border-b border-amber-200">
              This workspace is archived and read-only.
            </div>
          )}
          {children}
        </main>
      </div>
    </WorkspaceProvider>
  )
}
