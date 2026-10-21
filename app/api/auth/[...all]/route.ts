import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth'

// Better Auth's endpoints (sign-in, sign-out, session, admin plugin); see lib/auth.ts.
export const { GET, POST } = toNextJsHandler(auth)
