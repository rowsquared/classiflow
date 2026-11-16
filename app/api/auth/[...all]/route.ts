import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth'
import { clientIp } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

// Replace the internal IP header so Better Auth sees only the trusted address.
function withTrustedAddress(req: Request) {
  const ip = clientIp(req)
  const headers = new Headers(req.headers)
  headers.delete('x-classiflow-client-ip')
  if (ip !== 'unknown') headers.set('x-classiflow-client-ip', ip)
  // Next extends Request. Construct from the URL and stream so the native
  // constructor never tries to copy NextRequest's private state.
  const init = { method: req.method, headers, body: req.body, signal: req.signal, duplex: 'half' as const }
  return new Request(req.url, init)
}

const handler = toNextJsHandler(auth)
export const GET = (req: Request) => handler.GET(withTrustedAddress(req))
export async function POST(req: Request) {
  const response = await handler.POST(withTrustedAddress(req))
  const path = new URL(req.url).pathname
  if (response.status === 401 && (path === '/api/auth/sign-in/username' || path === '/api/auth/sign-in/email')) {
    await audit({
      workspaceId: null,
      actorId: null,
      action: 'user.sign_in_failed',
      entityType: 'authentication',
      entityId: 'sign-in'
    })
  }
  return response
}
