// Query keys for TanStack Query. Every workspace query starts with
// ['ws', workspaceId], so one workspace's data can never answer for another
// and `invalidateQueries({ queryKey: queryKeys.workspace(id) })` refreshes all
// of it. The cache itself lives in the workspace layout
// (components/QueryProvider.tsx) and is rebuilt when the workspace, the user
// or their role changes.

export const queryKeys = {
  /** Everything cached for one workspace. */
  workspace: (workspaceId: string) => ['ws', workspaceId] as const,

  /** Queue list and statistics; invalidate after labels or assignments change. */
  queue: (workspaceId: string) => ['ws', workspaceId, 'queue'] as const,
  queueList: (workspaceId: string, params: string) => ['ws', workspaceId, 'queue', 'list', params] as const,
  queueStats: (workspaceId: string, params: string) => ['ws', workspaceId, 'queue', 'stats', params] as const,

  sentence: (workspaceId: string, sentenceId: string) => ['ws', workspaceId, 'sentence', sentenceId] as const,
  comments: (workspaceId: string, sentenceId: string, includeResolved: boolean) =>
    ['ws', workspaceId, 'sentence', sentenceId, 'comments', { includeResolved }] as const,

  activeTaxonomies: (workspaceId: string) => ['ws', workspaceId, 'taxonomies', 'active'] as const,
  taxonomyNodes: (workspaceId: string, taxonomyKey: string, params: string) =>
    ['ws', workspaceId, 'taxonomies', taxonomyKey, 'nodes', params] as const,

  imports: (workspaceId: string) => ['ws', workspaceId, 'imports'] as const,
  members: (workspaceId: string) => ['ws', workspaceId, 'members'] as const,
  assignments: (workspaceId: string, sentenceIds: string) => ['ws', workspaceId, 'assignments', sentenceIds] as const,

  /** The caller's workspace directory (control plane, not workspace data). */
  workspaces: () => ['workspaces'] as const
}
