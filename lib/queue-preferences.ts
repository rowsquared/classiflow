import { loadQueueUrlState, serializeQueueUrlState } from '@/lib/queue-url'

type QueueScope = { id: string; role: string }

/** One browser preference per workspace, checked against the current account and role. */
export const queuePreferenceCookie = (workspaceId: string) => `classiflow-queue-${encodeURIComponent(workspaceId)}`

export function queuePreferenceValue(user: QueueScope, search: string): string {
  return JSON.stringify({ userId: user.id, role: user.role, search })
}

/** Restore known queue parameters only; the URL remains the source of truth. */
export function rememberedQueueSearch(value: string | undefined, user: QueueScope): string {
  if (!value || value.length > 3500) return ''
  try {
    const saved: unknown = JSON.parse(value)
    if (!saved || typeof saved !== 'object') return ''
    const preference = saved as Record<string, unknown>
    if (preference.userId !== user.id || preference.role !== user.role || typeof preference.search !== 'string')
      return ''
    return serializeQueueUrlState(loadQueueUrlState(new URLSearchParams(preference.search)))
  } catch {
    return ''
  }
}
