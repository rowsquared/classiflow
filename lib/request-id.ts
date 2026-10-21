import { headers } from 'next/headers'

/**
 * Request IDs tie log lines, audit entries and outgoing calls to one request.
 * proxy.ts sets `x-request-id` on every request it handles (keeping a
 * well-formed one from the reverse proxy) and returns it on the response, so
 * a person reporting an error can quote it.
 */
export const REQUEST_ID_HEADER = 'x-request-id'

// Letters, digits and a few separators; long enough to be unique, short
// enough not to bloat logs. Anything else from outside is replaced.
const WELL_FORMED = /^[A-Za-z0-9._:-]{8,128}$/

export function isWellFormedRequestId(value: string | null | undefined): value is string {
  return typeof value === 'string' && WELL_FORMED.test(value)
}

/** The incoming ID if it is well formed, otherwise a new one. */
export function requestIdFrom(incoming: string | null | undefined): string {
  return isWellFormedRequestId(incoming) ? incoming : crypto.randomUUID()
}

/**
 * The current request's ID, or null outside a request (background jobs,
 * scripts, tests calling handlers directly).
 */
export async function currentRequestId(): Promise<string | null> {
  try {
    const value = (await headers()).get(REQUEST_ID_HEADER)
    return isWellFormedRequestId(value) ? value : null
  } catch {
    return null
  }
}
