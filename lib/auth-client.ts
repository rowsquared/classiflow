import { createAuthClient } from 'better-auth/react'
import { adminClient, inferAdditionalFields, usernameClient } from 'better-auth/client/plugins'
import type { auth } from '@/lib/auth'

// Browser side of lib/auth.ts. Same origin, so no baseURL is needed.
export const authClient = createAuthClient({
  plugins: [usernameClient(), adminClient(), inferAdditionalFields<typeof auth>()]
})

export const { useSession, signOut, revokeOtherSessions } = authClient

/** Signs in with a username or an email address, whichever was typed. */
export function signInWithIdentifier(identifier: string, password: string) {
  const id = identifier.trim()
  return id.includes('@')
    ? authClient.signIn.email({ email: id, password })
    : authClient.signIn.username({ username: id, password })
}
