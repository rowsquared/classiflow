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

  /**
   * Progress reports. `scope` (lib/progress-url.ts scopeKey) names who a report
   * covers, so a section keeps showing its previous data while it reloads only
   * when the person and team stay the same.
   */
  progress: (workspaceId: string) => ['ws', workspaceId, 'progress'] as const,
  /** Team and person picker searches (lib/server/progress.ts searchReportMembers). */
  progressMembers: (workspaceId: string, params: string) => ['ws', workspaceId, 'progress', 'members', params] as const,
  progressReport: (workspaceId: string, report: 'overview' | 'activity' | 'people', scope: string, params: string) =>
    ['ws', workspaceId, 'progress', report, scope, params] as const,

  imports: (workspaceId: string) => ['ws', workspaceId, 'imports'] as const,

  /** AI jobs: the header badge's active list and the AI jobs page's history. */
  aiJobs: (workspaceId: string) => ['ws', workspaceId, 'ai-jobs'] as const,
  aiJobsActive: (workspaceId: string) => ['ws', workspaceId, 'ai-jobs', 'active'] as const,
  aiJobsHistory: (workspaceId: string, params: string) => ['ws', workspaceId, 'ai-jobs', 'history', params] as const,
  aiSettings: (workspaceId: string) => ['ws', workspaceId, 'ai-settings'] as const,

  /** Taxonomy administration list (with sync and learning status). */
  taxonomies: (workspaceId: string) => ['ws', workspaceId, 'taxonomies'] as const,
  taxonomyAdminList: (workspaceId: string) => ['ws', workspaceId, 'taxonomies', 'admin'] as const,

  audit: (workspaceId: string, params: string) => ['ws', workspaceId, 'audit', params] as const,
  members: (workspaceId: string) => ['ws', workspaceId, 'members'] as const,
  assignments: (workspaceId: string, sentenceIds: string) => ['ws', workspaceId, 'assignments', sentenceIds] as const,

  /** The caller's workspace directory (control plane, not workspace data). */
  workspaces: () => ['workspaces'] as const,
  /** Platform account pickers (control plane, outside the workspace caches). */
  accounts: () => ['accounts'] as const,
  accountsPage: (params: string) => ['accounts', 'list', params] as const,
  account: (userId: string) => ['accounts', 'user', userId] as const,
  /** Users directory (platform-wide or scoped to the viewer's administered workspaces). */
  directory: () => ['user-directory'] as const,
  directoryPage: (params: string) => ['user-directory', 'list', params] as const,
  directoryUser: (userId: string) => ['user-directory', 'user', userId] as const,
  accountLookup: (email: string) => ['accounts', 'lookup', email] as const,
  invitations: (workspaceId: string) => ['ws', workspaceId, 'invitations'] as const,
  deletionPreview: (workspaceId: string) => ['ws', workspaceId, 'deletion-preview'] as const
}
