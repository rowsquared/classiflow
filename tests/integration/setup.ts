import { vi } from 'vitest'
import { testDatabaseUrl } from './global-setup'

// Must run before lib/prisma.ts creates its client.
process.env.DATABASE_URL = testDatabaseUrl()

// Route handlers read the caller from auth(); tests choose the caller with signInAs().
vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => (globalThis as { __testSession?: unknown }).__testSession ?? null),
}))
