import { vi } from 'vitest'
import { testDatabaseUrl } from './global-setup'

// Must run before lib/prisma.ts creates its client.
process.env.DATABASE_URL = testDatabaseUrl()

// Route handlers read the caller from getSession(); tests choose the caller
// with signInAs(). The session is looked up in the database the way Better
// Auth does it, so revoked sessions and deleted users are really signed out.
vi.mock('@/lib/auth', async importOriginal => {
  const { sessionFor } = await import('./helpers')
  return {
    ...await importOriginal<typeof import('@/lib/auth')>(),
    getSession: vi.fn(sessionFor),
  }
})
