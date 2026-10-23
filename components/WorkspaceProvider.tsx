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
  remember = true,
  children
}: {
  value: WorkspaceInfo | null
  userId: string
  remember?: boolean
  children: ReactNode
}) {
  useEffect(() => {
    if (!remember || !value || value.archived) return
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `classiflow-last-workspace=${encodeURIComponent(`${userId}:${value.id}`)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
  }, [userId, value, remember])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

/** The current workspace, or the last accessible active workspace on global pages. */
export function useWorkspaceInfo(): WorkspaceInfo | null {
  return useContext(WorkspaceContext)
}
