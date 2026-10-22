/** Stable, workspace-scoped record URLs. Never include a browser-local navigation list. */
export function recordPath(workspaceId: string, sentenceId: string, discussion = false): string {
  return `/w/${encodeURIComponent(workspaceId)}/queue/${encodeURIComponent(sentenceId)}${discussion ? '?comments=open' : ''}`
}
