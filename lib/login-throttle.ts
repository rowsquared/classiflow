/**
 * Failed-login throttle, keyed by the identifier (username or email) typed in.
 *
 * After MAX_FAILURES failed attempts within WINDOW_MS the identifier is locked
 * for WINDOW_MS, even for the right password. State is in-process memory: it
 * resets on restart and is not shared between app instances, so a reverse proxy
 * rate limit is still the stronger control for public deployments.
 */

const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000
const MAX_TRACKED = 10_000

type Entry = { failures: number; firstFailureAt: number; lockedUntil: number }

const attempts = new Map<string, Entry>()

function key(identifier: string) {
  return identifier.trim().toLowerCase()
}

export function isLoginLocked(identifier: string, now = Date.now()): boolean {
  const entry = attempts.get(key(identifier))
  if (!entry) return false
  if (entry.lockedUntil > now) return true
  if (now - entry.firstFailureAt > WINDOW_MS) attempts.delete(key(identifier))
  return false
}

export function recordLoginFailure(identifier: string, now = Date.now()): void {
  const k = key(identifier)
  let entry = attempts.get(k)
  if (!entry || now - entry.firstFailureAt > WINDOW_MS) {
    entry = { failures: 0, firstFailureAt: now, lockedUntil: 0 }
  }
  entry.failures += 1
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = now + WINDOW_MS
  }
  attempts.set(k, entry)

  // Bound memory under a spray of random identifiers: drop the oldest entries.
  if (attempts.size > MAX_TRACKED) {
    const oldest = attempts.keys().next().value
    if (oldest !== undefined) attempts.delete(oldest)
  }
}

export function recordLoginSuccess(identifier: string): void {
  attempts.delete(key(identifier))
}

/** Test helper. */
export function resetLoginThrottle(): void {
  attempts.clear()
}
