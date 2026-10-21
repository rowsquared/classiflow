import createClient from 'openapi-fetch'
import type { paths } from '@/lib/contracts/taxomind.openapi'
import {
  createdJobId,
  jobStatusResponse,
  parseResponse,
  type JobStatusResponse,
  type LabelingRequest,
  type LearningRequest,
  type TaxomindResource,
  type TaxonomyRequest
} from '@/lib/contracts/taxomind'
import { logger } from '@/lib/logger'

// The HTTP boundary to Taxomind. Requests and responses follow its OpenAPI
// contract (lib/contracts/taxomind.ts); every response is parsed there.
//
// There is no deployment-wide client: each call goes through a client built
// from one workspace connection version (lib/ai-connections.ts), so a job
// always talks to the endpoint, with the credential, it started with.

// Timeout for individual HTTP requests to the external AI service.
// POST requests (sending batches) get a longer timeout since the server
// may take time to accept a large payload. GET requests (status polling)
// should respond quickly.
const AI_REQUEST_TIMEOUT_POST_MS = 3 * 60 * 1000 // 3 minutes
const AI_REQUEST_TIMEOUT_GET_MS = 30 * 1000 // 30 seconds

/** Where and how to reach Taxomind for one connection version. The credential is plaintext, in memory only. */
export type TaxomindConnection = { baseUrl: string; credential: string }

type Sent = { data?: unknown; error?: unknown; response: Response }

/**
 * Redirects are refused: an approved endpoint must not hand the bearer token
 * (or the records) on to another host.
 */
const noRedirects: typeof fetch = (input, init) =>
  fetch(input instanceof Request ? new Request(input, { redirect: 'error' }) : input, { ...init, redirect: 'error' })

/**
 * Sends one request with the method's timeout and returns the body of a 2xx
 * response. Non-2xx, timeouts and bodies that are not JSON become errors that
 * name the request. Error messages never contain the credential.
 */
async function send(
  method: 'GET' | 'POST',
  path: string,
  request: (signal: AbortSignal) => Promise<Sent>
): Promise<unknown> {
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
    if (error instanceof TypeError) {
      // fetch failed: DNS, refused connection, TLS, or a refused redirect
      throw new Error(`AI service could not be reached (${method} ${path}): ${error.message}`)
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

export type TaxomindClient = ReturnType<typeof taxomindClient>

export function taxomindClient({ baseUrl, credential }: TaxomindConnection) {
  const api = createClient<paths>({
    baseUrl,
    headers: { Authorization: `Bearer ${credential}` },
    fetch: noRedirects
  })

  return {
    /** Labeling job: POST /label. Returns Taxomind's job id. */
    async startLabelingJob(body: LabelingRequest): Promise<string> {
      const data = await send('POST', '/label', signal => api.POST('/label', { body, signal }))
      return createdJobId('label', data)
    },

    /** Learning job: POST /learn. Returns Taxomind's job id. */
    async startLearningJob(body: LearningRequest): Promise<string> {
      const data = await send('POST', '/learn', signal => api.POST('/learn', { body, signal }))
      return createdJobId('learn', data)
    },

    /** Taxonomy job: POST /taxonomies (Taxomind supports `action: 'create'` only). */
    async startTaxonomyJob(body: TaxonomyRequest): Promise<string> {
      const data = await send('POST', '/taxonomies', signal => api.POST('/taxonomies', { body, signal }))
      return createdJobId('taxonomies', data)
    },

    async fetchJobStatus(resource: TaxomindResource, externalJobId: string): Promise<JobStatusResponse> {
      const path = `/${resource}/${externalJobId}/status`
      const params = { path: { job_id: externalJobId } }
      const data = await send('GET', path, signal => {
        switch (resource) {
          case 'label':
            return api.GET('/label/{job_id}/status', { params, signal })
          case 'learn':
            return api.GET('/learn/{job_id}/status', { params, signal })
          case 'taxonomies':
            return api.GET('/taxonomies/{job_id}/status', { params, signal })
        }
      })
      return parseResponse(jobStatusResponse, data, `GET ${path}`)
    },

    /** Cancels a job on Taxomind. Best effort: failures are logged, not thrown. */
    async cancelJob(resource: TaxomindResource, externalJobId: string): Promise<void> {
      const path = `/${resource}/${externalJobId}/cancel`
      const params = { path: { job_id: externalJobId } }
      try {
        await send('POST', path, signal => {
          switch (resource) {
            case 'label':
              return api.POST('/label/{job_id}/cancel', { params, signal })
            case 'learn':
              return api.POST('/learn/{job_id}/cancel', { params, signal })
            case 'taxonomies':
              return api.POST('/taxonomies/{job_id}/cancel', { params, signal })
          }
        })
      } catch (error) {
        logger.warn({ externalJobId, err: error }, 'Failed to cancel external AI job')
      }
    }
  }
}
