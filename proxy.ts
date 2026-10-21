import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { isCrossSiteMutation } from '@/lib/cross-site'

// Enforced. Scripts need this request's nonce (Next adds it to its own
// scripts; app/layout.tsx passes it to the sidebar init script), and
// 'strict-dynamic' lets them load the chunks they import. Styles stay
// 'unsafe-inline' for React style attributes. The browser journeys
// (tests/e2e) fail on any violation.
function contentSecurityPolicy(nonce: string) {
  const dev = process.env.NODE_ENV === 'development'
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // API routes handle their own auth (lib/api-auth.ts). Here they only get a
  // cross-site check: a browser request that changes data must come from this
  // site. Requests without an Origin header (scripts) pass; Better Auth checks
  // the origin on its own routes too.
  if (pathname.startsWith('/api')) {
    if (isCrossSiteMutation(request)) {
      return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 })
    }
    return NextResponse.next()
  }

  // The same database-backed session the API sees: a revoked session, a
  // deleted or banned user is turned away from pages at once.
  const session = await auth.api.getSession({ headers: request.headers })
  const user = session?.user
  const isLoginPage = pathname === '/login'

  if (!user?.id && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (user?.id && isLoginPage) {
    return NextResponse.redirect(new URL('/queue', request.url))
  }
  if (user?.mustResetPassword && pathname !== '/reset-password') {
    return NextResponse.redirect(new URL('/reset-password', request.url))
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = contentSecurityPolicy(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files
     */
    '/((?!_next/static|_next/image|favicon.ico|favicon-16x16.png|favicon-32x32.png|favicon.svg|logo.svg|r2-footer.svg).*)',
  ],
}
