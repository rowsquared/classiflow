'use client'

import { useQuery } from '@tanstack/react-query'
import { useWorkspacePaths } from '@/lib/workspace/urls'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetch'
import type { RecordAnnotation } from '@/lib/labeling'
import type { Taxonomy } from '@/components/TaxonomyBrowser'

// Data of the labelling screen: the record, the workspace's active
// taxonomies and the record's comments, as TanStack Query queries.

export type LabelingRecord = {
  id: string
  field1: string
  field2?: string | null
  field3?: string | null
  field4?: string | null
  field5?: string | null
  support1?: string | null
  support2?: string | null
  support3?: string | null
  support4?: string | null
  support5?: string | null
  fieldMapping: Record<string, string>
  supportMapping?: Record<string, string> | null
  status: string
  flagged: boolean
  lastEditedAt: string | null
  annotations: RecordAnnotation[]
  comments?: unknown[]
  commentSummary?: { total: number; unresolved: number }
  _count?: { comments: number }
}

export type RecordComment = {
  id: string
  body: string
  createdAt: string
  resolved: boolean
  resolvedAt: string | null
  author: { name: string | null }
}

export type CommentsResponse = {
  comments?: RecordComment[]
  hasResolved?: boolean
  commentSummary?: { total: number; unresolved: number }
}

/** The record; refetched whenever the screen opens it, since others may have labelled it. */
export function useRecord(sentenceId: string) {
  const { workspaceId, api } = useWorkspacePaths()
  return useQuery({
    queryKey: queryKeys.sentence(workspaceId, sentenceId),
    queryFn: ({ signal }) => fetchJson<LabelingRecord>(api(`/sentences/${sentenceId}`), { signal }),
    staleTime: 0
  })
}

export function useActiveTaxonomies() {
  const { workspaceId, api } = useWorkspacePaths()
  return useQuery({
    queryKey: queryKeys.activeTaxonomies(workspaceId),
    queryFn: async ({ signal }) => {
      const data = await fetchJson<{ ok?: boolean; taxonomies?: Taxonomy[] }>(api('/taxonomies/active'), { signal })
      return (data.taxonomies ?? []).map((t): Taxonomy => ({
        key: t.key,
        maxDepth: t.maxDepth || 5,
        levelNames: t.levelNames
      }))
    }
  })
}

/** Comments, loaded while the discussion is open (fresh on every opening). */
export function useComments(sentenceId: string, includeResolved: boolean, enabled: boolean) {
  const { workspaceId, api } = useWorkspacePaths()
  return useQuery({
    queryKey: queryKeys.comments(workspaceId, sentenceId, includeResolved),
    queryFn: ({ signal }) =>
      fetchJson<CommentsResponse>(
        api(`/sentences/${sentenceId}/comments?includeResolved=${includeResolved ? 'true' : 'false'}`),
        { signal }
      ),
    enabled,
    staleTime: 0
  })
}
