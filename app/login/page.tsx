import { mailEnabled } from '@/lib/mail/config'
import LoginClient from './LoginClient'

/** Only paths on this site, never another origin ("//host" or "/\host"). */
function safeNext(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams
  return <LoginClient mailEnabled={mailEnabled()} next={safeNext(next)} />
}
