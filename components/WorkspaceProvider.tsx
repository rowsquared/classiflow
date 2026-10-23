'use client'

import { createContext, useContext, useEffect, type ReactNode } from 'react'

export type WorkspaceInfo = {
  id: string
  name: string
  role: 'admin' | 'supervisor' | 'labeller'
  authority: 'membership' | 'platform'
  archived: boolean
}

const WorkspaceContext = createContext<WorkspaceInfo | null>(null)

/** Set by app/w/[workspaceId]/layout.tsx from the server's access check. */
export function WorkspaceProvider({
  value,
  userId,
  children
}: {
  value: WorkspaceInfo
  userId: string
  children: ReactNode
}) {
  useEffect(() => {
    if (value.archived) return
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `classiflow-last-workspace=${encodeURIComponent(`${userId}:${value.id}`)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
  }, [userId, value.id, value.archived])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

/** The current workspace (null outside /w/[workspaceId]). */
export function useWorkspaceInfo(): WorkspaceInfo | null {
  return useContext(WorkspaceContext)
}
