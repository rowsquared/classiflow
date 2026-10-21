import createClient from 'openapi-fetch'
import {
  AI_JOB_POLL_INTERVAL_MS,
  AI_JOB_POLL_TIMEOUT_MS
} from '@/lib/constants'
import type { paths } from '@/lib/contracts/taxomind.openapi'
import {
  createdJobId,
  jobStatusResponse,
  parseResponse,
  type JobStatusResponse,
  type LabelingRequest,
  type LearningRequest,
  type TaxomindResource,
  type TaxonomyRequest,
} from '@/lib/contracts/taxomind'

// The HTTP boundary to Taxomind. Requests and responses follow its OpenAPI
// contract (lib/contracts/taxomind.ts); every response is parsed there.

const API_URL = process.env.AI_LABELING_API_URL
const API_KEY = process.env.AI_LABELING_API_KEY

// Timeout for individual HTTP requests to the external AI service.
// POST requests (sending batches) get a longer timeout since the server
// may take time to accept a large payload. GET requests (status polling)
// should respond quickly.
const AI_REQUEST_TIMEOUT_POST_MS = 3 * 60 * 1000 // 3 minutes
const AI_REQUEST_TIMEOUT_GET_MS = 30 * 1000       // 30 seconds

export function ensureAIConfig() {
  if (!API_URL || !API_KEY) {
    throw new Error('AI labeling service is not configured. Please set AI_LABELING_API_URL and AI_LABELING_API_KEY.')
  }
}

let taxomindClient: ReturnType<typeof createClient<paths>> | undefined

function taxomind() {
  ensureAIConfig()
  taxomindClient ??= createClient<paths>({
    baseUrl: API_URL,
    headers: { Authorization: `Bearer ${API_KEY}` },
  })
  return taxomindClient
}

type Sent = { data?: unknown; error?: unknown; response: Response }

/**
 * Sends one request with the method's timeout and returns the body of a 2xx
 * response. Non-2xx, timeouts and bodies that are not JSON become errors that
 * name the request.
 */
async function send(method: 'GET' | 'POST', path: string, request: (signal: AbortSignal) => Promise<Sent>): Promise<unknown> {
  const timeoutMs = method === 'POST' ? AI_REQUEST_TIMEOUT_POST_MS : AI_REQUEST_TIMEOUT_GET_MS
  let sent: Sent
  try {
    sent = await request(AbortSignal.timeout(timeoutMs))
  } catch (error: unknown) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`AI service request timed out after ${timeoutMs / 1000}s (${method} ${path})`)
    }
    if (error instanceof SyntaxError) {
      throw new Error(`AI service returned a body that is not JSON (${method} ${path})`)
    }
    throw error
  }

  const { data, error, response } = sent
  if (!response.ok) {
    const text = typeof error === 'string' ? error : error === undefined ? '' : JSON.stringify(error)
    throw new Error(`AI labeling API error (${response.status}): ${text || response.statusText}`)
  }
  return data
}

/** Labeling job: POST /label. Returns Taxomind's job id. */
export async function startLabelingJob(body: LabelingRequest): Promise<string> {
  const data = await send('POST', '/label', signal => taxomind().POST('/label', { body, signal }))
  return createdJobId('label', data)
}

/** Learning job: POST /learn. Returns Taxomind's job id. */
export async function startLearningJob(body: LearningRequest): Promise<string> {
  const data = await send('POST', '/learn', signal => taxomind().POST('/learn', { body, signal }))
  return createdJobId('learn', data)
}

/**
 * Taxonomy job: POST /taxonomies. The taxonomy routes build the payload; it is
 * not narrowed to TaxonomyRequest yet (see M09 in
 * docs/plans/modernization-2026-10.md), so Taxomind validates it (422).
 */
export async function startAIJob(path: '/taxonomies', payload: unknown): Promise<string> {
  const data = await send('POST', path, signal => taxomind().POST(path, { body: payload as TaxonomyRequest, signal }))
  return createdJobId('taxonomies', data)
}

export async function fetchAIJobStatus(resource: TaxomindResource, externalJobId: string): Promise<JobStatusResponse> {
  const path = `/${resource}/${externalJobId}/status`
  const params = { path: { job_id: externalJobId } }
  const data = await send('GET', path, signal => {
    switch (resource) {
      case 'label': return taxomind().GET('/label/{job_id}/status', { params, signal })
      case 'learn': return taxomind().GET('/learn/{job_id}/status', { params, signal })
      case 'taxonomies': return taxomind().GET('/taxonomies/{job_id}/status', { params, signal })
    }
  })
  return parseResponse(jobStatusResponse, data, `GET ${path}`)
}

/**
 * Cancel a running job on the external AI API.
 * Best-effort: failures are logged but not thrown.
 */
export async function cancelAIJob(apiPath: `/${TaxomindResource}`, externalJobId: string): Promise<void> {
  const path = `${apiPath}/${externalJobId}/cancel`
  const params = { path: { job_id: externalJobId } }
  try {
    await send('POST', path, signal => {
      switch (apiPath) {
        case '/label': return taxomind().POST('/label/{job_id}/cancel', { params, signal })
        case '/learn': return taxomind().POST('/learn/{job_id}/cancel', { params, signal })
        case '/taxonomies': return taxomind().POST('/taxonomies/{job_id}/cancel', { params, signal })
      }
    })
  } catch (error) {
    console.warn(`[ai] Failed to cancel external job ${externalJobId}:`, error)
  }
}

export type AIJobResult =
  | { success: true; data: JobStatusResponse }
  | { success: false; data?: JobStatusResponse; error: string }

export async function waitForAIJobResult(resource: TaxomindResource, jobId: string): Promise<AIJobResult> {
  const startedAt = Date.now()
  while (true) {
    try {
      const status = await fetchAIJobStatus(resource, jobId)
      if (status.status === 'completed') {
        return { success: true, data: status }
      }
      if (status.status === 'failed') {
        return { success: false, data: status, error: status.error || 'AI job failed' }
      }
      if (status.status === 'canceled') {
        return { success: false, data: status, error: status.error || 'AI job was cancelled in the AI service' }
      }
    } catch (error: unknown) {
      if (Date.now() - startedAt >= AI_JOB_POLL_TIMEOUT_MS) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage || `AI job ${jobId} failed` }
      }
      // continue polling after delay
    }

    if (Date.now() - startedAt >= AI_JOB_POLL_TIMEOUT_MS) {
      return { success: false, error: `AI job ${jobId} timed out after ${AI_JOB_POLL_TIMEOUT_MS}ms` }
    }

    await new Promise((resolve) => setTimeout(resolve, AI_JOB_POLL_INTERVAL_MS))
  }
}

/** Polls `statusPath` (`/{resource}/{jobId}/status`) in the background until the job ends. */
export function monitorAIJob(
  jobId: string,
  statusPath: `/${TaxomindResource}/${string}/status`,
  handler: (result: AIJobResult) => Promise<void> | void
) {
  const resource = statusPath.split('/')[1] as TaxomindResource
  waitForAIJobResult(resource, jobId)
    .then(handler)
    .catch(error => handler({ success: false, error: error instanceof Error ? error.message : String(error) }))
}
