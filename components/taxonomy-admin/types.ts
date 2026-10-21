export type Taxonomy = {
  id: string
  key: string
  description: string | null
  levelNames: Record<string, string> | null
  maxDepth: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  nodeCount: number
  annotationCount: number
  actualMaxLevel: number
  levelCounts: Array<{
    level: number
    count: number
    name: string
  }>
  lastAISyncAt?: string | null
  lastAISyncStatus?: string | null
  lastAISyncError?: string | null
  lastAISyncJobId?: string | null
  lastLearningAt?: string | null
  lastLearningJobId?: string | null
  lastLearningStatus?: string | null
  lastLearningError?: string | null
  newAnnotationsSinceLastLearning: number
}

export type TaxonomyList = { taxonomies: Taxonomy[]; learningThreshold: number }

/** A page-level result line (success or error) shown above the taxonomy cards. */
export type Message = { type: 'success' | 'error'; text: string }

export const MAX_ACTIVE_TAXONOMIES = 3
