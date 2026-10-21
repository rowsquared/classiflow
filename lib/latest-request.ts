/**
 * Keeps only the most recent of a series of requests: starting one aborts the
 * previous one, and `isCurrent()` tells a response handler whether a newer
 * request has replaced it since. Used where filters change faster than the
 * server answers, so an old, slow response can never overwrite a newer result.
 */
export function createLatestRequest() {
  let current: AbortController | null = null
  return {
    start() {
      current?.abort()
      const controller = new AbortController()
      current = controller
      return { signal: controller.signal, isCurrent: () => current === controller }
    },
    cancel() {
      current?.abort()
      current = null
    }
  }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}
