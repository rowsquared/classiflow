'use client'

import { useParams } from 'next/navigation'

// Links and API calls name their workspace explicitly (the URL is the source
// of truth, so two tabs can work in different workspaces). Pages live under
// /w/[workspaceId], their APIs under /api/workspaces/[workspaceId].

/** The workspace in the current URL, or null outside one. */
export function useWorkspaceId(): string | null {
  const params = useParams<{ workspaceId?: string }>()
  return typeof params?.workspaceId === 'string' ? params.workspaceId : null
}

/** Page and API paths for the workspace in the current URL. */
export function useWorkspacePaths() {
  const workspaceId = useWorkspaceId() ?? ''
  return {
    workspaceId,
    /** `/w/<id><path>` for links and navigation. */
    href: (path: string) => `/w/${workspaceId}${path}`,
    /** `/api/workspaces/<id><path>` for fetch. */
    api: (path: string) => `/api/workspaces/${workspaceId}${path}`
  }
}

/**
 * The API path in the workspace of the current URL, for event handlers and
 * effects outside React render (fetch helpers). Throws outside a workspace page.
 */
export function workspaceApi(path: string): string {
  const match = typeof window !== 'undefined' ? window.location.pathname.match(/^\/w\/([^/]+)/) : null
  if (!match) throw new Error('Not on a workspace page')
  return `/api/workspaces/${match[1]}${path}`
}

/** The page path in the workspace of the current URL, for navigation in event handlers. */
export function workspaceHref(path: string): string {
  const match = typeof window !== 'undefined' ? window.location.pathname.match(/^\/w\/([^/]+)/) : null
  if (!match) throw new Error('Not on a workspace page')
  return `/w/${match[1]}${path}`
}
