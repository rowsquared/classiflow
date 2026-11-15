import type { NextRequest } from 'next/server'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** True for a state-changing request whose Origin is another site. See proxy.ts. */
export function isCrossSiteMutation(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false
  if (
    request.nextUrl.pathname.startsWith('/api/auth/') &&
    !/^\/api\/auth\/(reset-password|forgot-password|set-password)(\/|$)/.test(request.nextUrl.pathname)
  ) {
    return false
  }
  const origin = request.headers.get('origin')
  if (!origin) return false
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return true
  }
  const allowed = [request.headers.get('host'), request.headers.get('x-forwarded-host'), request.nextUrl.host]
  return !allowed.some(h => h && h.split(',')[0]?.trim() === originHost)
}
