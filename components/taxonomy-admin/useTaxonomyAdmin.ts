'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceInfo } from '@/components/WorkspaceProvider'
import { fetchJson } from '@/lib/query/fetch'
import { queryKeys } from '@/lib/query/keys'
import { hasActiveAIJobs } from '@/lib/taxonomy-admin'
import { workspaceApi } from '@/lib/workspace/urls'
import type { Taxonomy, TaxonomyList } from './types'

/**
 * The workspace's taxonomies with their node counts and AI status, starting
 * from the server-rendered list. While a sync or learning job runs the list
 * refreshes every 5 s (paused in hidden tabs). `refresh()` invalidates every
 * taxonomy query of the workspace (this list, the active list the labelling
 * screens use, node lists).
 */
export function useTaxonomyAdmin(initial: TaxonomyList) {
  const workspaceId = useWorkspaceInfo()?.id ?? ''
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.taxonomyAdminList(workspaceId),
    queryFn: async ({ signal }): Promise<TaxonomyList> => {
      const data = await fetchJson<{ ok?: boolean; taxonomies?: Taxonomy[]; learningThreshold?: number }>(
        workspaceApi('/taxonomies'),
        { signal }
      )
      return {
        taxonomies: data.taxonomies ?? [],
        learningThreshold:
          typeof data.learningThreshold === 'number' ? data.learningThreshold : initial.learningThreshold
      }
    },
    initialData: initial,
    refetchInterval: q => (hasActiveAIJobs(q.state.data?.taxonomies ?? []) ? 5000 : false)
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.taxonomies(workspaceId) })
  /** After starting an AI job: the badge and the AI jobs page show it too. */
  const refreshAIJobs = () => queryClient.invalidateQueries({ queryKey: queryKeys.aiJobs(workspaceId) })

  return {
    taxonomies: query.data.taxonomies,
    learningThreshold: query.data.learningThreshold,
    loadFailed: query.isError,
    refresh,
    refreshAIJobs
  }
}
