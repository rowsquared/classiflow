'use client'

import { createContext, useContext, type ReactNode } from 'react'

export type WorkspaceInfo = {
  id: string
  name: string
  role: 'admin' | 'supervisor' | 'labeller'
  authority: 'membership' | 'platform'
  archived: boolean
}

const WorkspaceContext = createContext<WorkspaceInfo | null>(null)

/** Set by app/w/[workspaceId]/layout.tsx from the server's access check. */
export function WorkspaceProvider({ value, children }: { value: WorkspaceInfo; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

/** The current workspace (null outside /w/[workspaceId]). */
export function useWorkspaceInfo(): WorkspaceInfo | null {
  return useContext(WorkspaceContext)
}
