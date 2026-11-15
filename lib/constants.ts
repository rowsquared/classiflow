export const UNKNOWN_NODE_CODES: Record<1 | 2 | 3 | 4 | 5, string> = {
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
function positiveAISetting(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
    throw new Error(`${name} must be a positive integer no greater than 2147483647`)
  }
  return parsed
}

export const AI_LABELING_BATCH_SIZE = positiveAISetting(
  'AI_LABELING_BATCH_SIZE',
  process.env.AI_LABELING_BATCH_SIZE,
  1000
)
export const AI_LEARNING_BATCH_SIZE = positiveAISetting(
  'AI_LEARNING_BATCH_SIZE',
  process.env.AI_LEARNING_BATCH_SIZE,
  100
)
export const AI_LEARNING_MIN_NEW_ANNOTATIONS = positiveAISetting(
  'AI_LEARNING_MIN_NEW_ANNOTATIONS',
  process.env.AI_LEARNING_MIN_NEW_ANNOTATIONS,
  500
)
export const AI_JOB_POLL_INTERVAL_MS = positiveAISetting(
  'AI_JOB_POLL_INTERVAL_MS',
  process.env.AI_JOB_POLL_INTERVAL_MS,
  60_000
)
export const AI_JOB_POLL_TIMEOUT_MS = positiveAISetting(
  'AI_JOB_POLL_TIMEOUT_MS',
  process.env.AI_JOB_POLL_TIMEOUT_MS,
  18_000_000
)
export const AI_SOURCE_SLUG = process.env.AI_SOURCE_SLUG || ''
// Jobs sent to the AI service at once (lib/ai-job-monitor.ts admission): per
// workspace and for the whole deployment. Further jobs wait as "pending".
export const AI_MAX_ACTIVE_JOBS_PER_WORKSPACE = positiveAISetting(
  'AI_MAX_ACTIVE_JOBS_PER_WORKSPACE',
  process.env.AI_MAX_ACTIVE_JOBS_PER_WORKSPACE,
  3
)
export const AI_MAX_ACTIVE_JOBS = positiveAISetting('AI_MAX_ACTIVE_JOBS', process.env.AI_MAX_ACTIVE_JOBS, 10)

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
