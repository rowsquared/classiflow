import { redirect } from 'next/navigation'
import { requirePageUser } from '@/lib/server/page-user'
export default async function TeamPage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { workspaceId } = await params
  await requirePageUser(workspaceId, 'admin')
  const old = await searchParams
  const query = new URLSearchParams({ workspace: workspaceId })
  for (const key of ['q', 'role', 'supervisor', 'activity']) if (typeof old[key] === 'string') query.set(key, old[key])
  if (old.status === 'removed') query.set('access', 'removed')
  if (old.status === 'all') query.set('access', 'all')
  if (old.status === 'must-reset') query.set('setup', 'password')
  if (old.status === 'invited') query.set('setup', 'invited')
  redirect(`/users?${query}`)
}
