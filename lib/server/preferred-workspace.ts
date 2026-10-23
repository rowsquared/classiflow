import 'server-only'
import { cookies } from 'next/headers'
import type { SessionUser } from '@/lib/api-auth'
import { listAccessibleWorkspaces } from '@/lib/server/workspaces'

/** A navigation preference, always checked against the account's current access. */
export async function preferredWorkspace(user: SessionUser) {
  const workspaces = await listAccessibleWorkspaces(user)
  const active = workspaces.filter(w => w.status === 'active')
  const remembered = (await cookies()).get('classiflow-last-workspace')?.value
  return active.find(w => remembered === `${user.id}:${w.id}`) ?? active[0] ?? null
}
