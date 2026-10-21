import { z } from 'zod'
import type { components } from './taxomind.openapi'

/**
 * The Taxomind HTTP contract (https://github.com/rowsquared/taxomind).
 *
 * Taxomind is a FastAPI service and publishes its OpenAPI document at
 * `/openapi.json`. A snapshot is committed next to this file
 * (`taxomind.openapi.json`, Taxomind `f7a9e91`); `taxomind.openapi.ts` is
 * generated from it (`npm run taxomind:types`) and types the requests that
 * lib/ai-labeling.ts sends through openapi-fetch.
 *
 * Generated types are not checked at run time, so every response classiflow
 * reads is parsed here as well. The schemas cover only the fields classiflow
 * uses, and each is checked against the generated type (`satisfies`), so a
 * regenerated contract that renames or retypes one of them fails typecheck.
 */

type Schemas = components['schemas']

export type LabelingRequest = Schemas['LabelingRequest']
export type LearningRequest = Schemas['LearningRequest']
export type TaxonomyRequest = Schemas['TaxonomyRequest']

/** API resources with the job lifecycle POST /x, GET /x/{id}/status, POST /x/{id}/cancel. */
export type TaxomindResource = 'label' | 'learn' | 'taxonomies'

export class TaxomindContractError extends Error {
  name = 'TaxomindContractError'
}

/** Parses a response body; a mismatch throws with the endpoint and the first problems. */
export function parseResponse<S extends z.ZodType>(schema: S, body: unknown, endpoint: string): z.output<S> {
  const result = schema.safeParse(body)
  if (result.success) return result.data
  const issues = result.error.issues
    .slice(0, 3)
    .map(issue => `${issue.path.join('.') || '(body)'}: ${issue.message}`)
    .join('; ')
  throw new TaxomindContractError(`Unexpected response from the AI service (${endpoint}): ${issues}`)
}

// ---------------------------------------------------------------------------
// Job creation (202) — the id key differs per resource
// ---------------------------------------------------------------------------

const id = z.string().trim().min(1)

export const jobCreated = {
  label: z.object({ job_id: id }) satisfies z.ZodType<Pick<Schemas['LabelingJobResponse'], 'job_id'>>,
  learn: z.object({ jobId: id }) satisfies z.ZodType<Pick<Schemas['LearningJobResponse'], 'jobId'>>,
  taxonomies: z.object({ job_id: id }) satisfies z.ZodType<Pick<Schemas['TaxonomyJobResponse'], 'job_id'>>
}

export function createdJobId(resource: TaxomindResource, body: unknown): string {
  if (resource === 'learn') return parseResponse(jobCreated.learn, body, 'POST /learn').jobId
  return parseResponse(jobCreated[resource], body, `POST /${resource}`).job_id
}

// ---------------------------------------------------------------------------
// Job status — same shape for all three resources as far as classiflow reads it
// ---------------------------------------------------------------------------

export const jobStatus = z.enum(['pending', 'running', 'completed', 'failed', 'canceled']) satisfies z.ZodType<
  Schemas['JobStatus']
>

export type JobStatus = z.output<typeof jobStatus>

/**
 * `status` must be one of Taxomind's values; anything else is a malformed
 * response. `progress` and `error` are informational, so a bad value is
 * dropped instead of failing the poll. `result` is checked by its consumer
 * (parseLabelingResults), record by record.
 */
export const jobStatusResponse = z.object({
  status: jobStatus,
  progress: z.number().min(0).max(1).nullish().catch(null),
  error: z.string().nullish().catch(null),
  result: z.unknown().optional()
}) satisfies z.ZodType<
  StatusFields<'LabelingStatusResponse'> &
    StatusFields<'LearningStatusResponse'> &
    StatusFields<'TaxonomyStatusResponse'>
>

type StatusFields<S extends 'LabelingStatusResponse' | 'LearningStatusResponse' | 'TaxonomyStatusResponse'> = Pick<
  Schemas[S],
  'status' | 'progress' | 'error'
>

export type JobStatusResponse = z.output<typeof jobStatusResponse>

// ---------------------------------------------------------------------------
// Labeling results (LabelingStatusResponse.result once completed)
// ---------------------------------------------------------------------------

export type ParsedSuggestion = { level: number; nodeCode: string; confidence: number }

const MAX_CODE_LENGTH = 100

// Codes stay strings: leading zeros ("011") and the unknown codes "-9".."-99999"
// pass through unchanged; whether a code exists is checked against the taxonomy
// when the results are stored.
const annotation = z.object({
  level: z.int().min(1).max(5),
  nodeCode: z.string().trim().min(1).max(MAX_CODE_LENGTH),
  confidence: z
    .number()
    .catch(0)
    .transform(c => Math.min(Math.max(c, 0), 1))
})

const suggestion = z.object({
  sentenceId: z.string(),
  annotations: z
    .array(annotation)
    .refine(list => new Set(list.map(a => a.level)).size === list.length, 'levels must be unique')
}) satisfies z.ZodType<Schemas['SentenceSuggestion']>

/**
 * Validation of a completed labeling job's result.
 *
 * Only records that belong to the job are accepted (a response can never
 * overwrite suggestions of unrelated records), and each record at most once.
 * Per record: levels are integers 1..5 and unique, codes are non-empty strings,
 * confidence is clamped to 0..1. A record that fails is dropped and counted as
 * rejected; the rest of the result is still used. A missing or malformed
 * `suggestions` / `errors` list counts as empty.
 */
export function parseLabelingResults(
  raw: unknown,
  allowedSentenceIds: string[]
): { bySentence: Map<string, ParsedSuggestion[]>; rejected: number; serviceErrors: number } {
  const response = (raw && typeof raw === 'object' ? raw : {}) as { suggestions?: unknown; errors?: unknown }
  const allowed = new Set(allowedSentenceIds)
  const bySentence = new Map<string, ParsedSuggestion[]>()
  let rejected = 0

  const suggestions = Array.isArray(response.suggestions) ? response.suggestions : []
  for (const item of suggestions) {
    const parsed = suggestion.safeParse(item)
    if (!parsed.success || !allowed.has(parsed.data.sentenceId) || bySentence.has(parsed.data.sentenceId)) {
      rejected++
      continue
    }
    bySentence.set(parsed.data.sentenceId, parsed.data.annotations)
  }

  const serviceErrors = Array.isArray(response.errors) ? response.errors.length : 0
  return { bySentence, rejected, serviceErrors }
}
