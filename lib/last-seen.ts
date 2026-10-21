import { prisma } from '@/lib/prisma'

/**
 * "Last seen" in a workspace: the app was open in that workspace and loading
 * data, not proof somebody was typing. Written by workspace requests and page
 * loads, at most once per LAST_SEEN_INTERVAL per membership; background polls
 * (the AI job badge) are passive and never count.
 *
 * Raw SQL, so `updatedAt` stays the time of the last real edit, and one
 * conditional statement collapses parallel requests into one write. A failure
 * is logged and never fails the request.
 */
export const LAST_SEEN_INTERVAL = '5 minutes'

// Prisma stores DateTime as UTC in "timestamp without time zone"; now() would
// be converted to the server's local time zone instead.
export async function touchLastSeen(membershipId: string): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE "WorkspaceMembership" SET "lastSeenAt" = (now() AT TIME ZONE 'UTC')
      WHERE id = ${membershipId}
        AND ("lastSeenAt" IS NULL
          OR "lastSeenAt" < (now() AT TIME ZONE 'UTC') - ${LAST_SEEN_INTERVAL}::interval
          OR "lastSeenAt" > (now() AT TIME ZONE 'UTC'))`
  } catch (error) {
    console.error('[last-seen] could not record activity:', error)
  }
}
