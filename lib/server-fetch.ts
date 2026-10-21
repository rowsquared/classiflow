import { cookies } from 'next/headers'

// Server components call this app's own API with the user's cookies. The target
// is fixed to this server (loopback), never derived from the request's Host or
// X-Forwarded-* headers: a spoofed Host must not redirect the session cookie to
// another server. INTERNAL_APP_URL overrides it if the app listens elsewhere.
function buildBaseUrl() {
  return process.env.INTERNAL_APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`
}

async function buildCookieHeader() {
  const cookieStore = await cookies()
  const serialized = cookieStore.getAll().map(({ name, value }) => `${name}=${value}`).join('; ')
  return serialized || undefined
}

export async function serverFetchJSON<T>(
  path: string,
  init: RequestInit = {},
  { silent } = { silent: false }
): Promise<T | null> {
  const baseUrl = buildBaseUrl()
  const cookieHeader = await buildCookieHeader()
  const headersInit: HeadersInit = {
    ...(init.headers || {}),
    ...(cookieHeader ? { Cookie: cookieHeader } : {})
  }

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: headersInit,
      cache: init.cache ?? 'no-store'
    })

    if (!res.ok) {
      if (!silent) {
        console.error(`serverFetchJSON ${path} failed:`, res.status, res.statusText)
      }
      return null
    }

    return res.json()
  } catch (error) {
    if (!silent) {
      console.error(`serverFetchJSON ${path} threw:`, error)
    }
    return null
  }
}

