// fetch for query functions: passes the abort signal TanStack Query provides
// (so superseded and abandoned requests are cancelled), throws on non-2xx so
// the query lands in its error state, and parses JSON.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super(
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Request failed with status ${status}`
    )
    this.name = 'HttpError'
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new HttpError(res.status, body)
  return body as T
}

/** Default retry rule: client errors (4xx) do not get better by retrying. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof HttpError && error.status >= 400 && error.status < 500) return false
  return failureCount < 1
}
