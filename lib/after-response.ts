import { after } from 'next/server'
import { afterCommit, currentWorkspaceId } from '@/lib/workspace/db'
import { logError } from '@/lib/logger'

const running = new Set<Promise<unknown>>()

function track(task: () => Promise<unknown>) {
  const promise = task()
    .catch(error => logError('Background task after the response failed', error))
    .finally(() => running.delete(promise))
  running.add(promise)
  return promise
}

/**
 * Runs `task` after the response has been sent (Next's `after()`), so slow
 * work such as sending mail does not hold the request. Inside a workspace
 * transaction it is scheduled only once that transaction has committed, and
 * not at all if it rolls back. Outside a request (scripts, tests) it starts
 * at once in the background.
 */
export function runAfterResponse(task: () => Promise<unknown>): void {
  const schedule = () => {
    try {
      after(() => track(task))
    } catch {
      // No request scope.
      void track(task)
    }
  }
  if (currentWorkspaceId()) afterCommit(schedule)
  else schedule()
}

/** Tests: waits until every background task started so far has finished. */
export async function settleBackgroundTasks(): Promise<void> {
  while (running.size > 0) await Promise.all([...running])
}
