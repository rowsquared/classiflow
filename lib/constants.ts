export const UNKNOWN_NODE_CODES: Record<number, string> = {
  1: '-9',
  2: '-99',
  3: '-999',
  4: '-9999',
  5: '-99999'
}

export const UNKNOWN_NODE_CODE_SET = new Set(Object.values(UNKNOWN_NODE_CODES))

export const getUnknownCodeForLevel = (level: number): string => {
  if (level in UNKNOWN_NODE_CODES) {
    return UNKNOWN_NODE_CODES[level as keyof typeof UNKNOWN_NODE_CODES]
  }
  // Default to deepest level code if an unexpected level is provided
  return UNKNOWN_NODE_CODES[5]
}

export const isUnknownNodeCode = (code: string | null | undefined): boolean => {
  if (code === null || code === undefined) return false
  return UNKNOWN_NODE_CODE_SET.has(code)
}
export const AI_LABELING_BATCH_SIZE = parseInt(process.env.AI_LABELING_BATCH_SIZE || '1000', 10)
export const AI_LEARNING_BATCH_SIZE = parseInt(process.env.AI_LEARNING_BATCH_SIZE || '100', 10)
export const AI_LEARNING_MIN_NEW_ANNOTATIONS = parseInt(process.env.AI_LEARNING_MIN_NEW_ANNOTATIONS || '500', 10)
export const AI_JOB_POLL_INTERVAL_MS = parseInt(process.env.AI_JOB_POLL_INTERVAL_MS || '60000', 10)
export const AI_JOB_POLL_TIMEOUT_MS = parseInt(process.env.AI_JOB_POLL_TIMEOUT_MS || '18000000', 10)
export const AI_SOURCE_SLUG = process.env.AI_SOURCE_SLUG || ''

/**
 * The AI service namespace of one workspace: the deployment's AI_SOURCE_SLUG
 * plus the workspace's immutable id, so two workspaces never share a model
 * even when their taxonomy keys are equal. Sent on every sync, labeling and
 * learning request; AI_SOURCE_SLUG is required when AI is enabled.
 */
export function aiSourceSlug(workspaceId: string): string {
  if (!AI_SOURCE_SLUG) throw new Error('AI_SOURCE_SLUG must be set when the AI service is configured')
  return `${AI_SOURCE_SLUG}--${workspaceId}`
}


