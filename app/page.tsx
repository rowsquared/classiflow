import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { requirePageSession } from '@/lib/server/page-user'
import { listAccessibleWorkspaces } from '@/lib/server/workspaces'

// Only redirect to a workspace that is still active and accessible.
export default async function HomePage() {
  const user = await requirePageSession()
  const workspaces = await listAccessibleWorkspaces(user)
  const active = workspaces.filter(w => w.status === 'active')
  const remembered = (await cookies()).get('classiflow-last-workspace')?.value
  const target = active.find(w => remembered === `${user.id}:${w.id}`) ?? active[0]
  if (target) redirect(`/w/${target.id}/queue`)
  redirect('/workspaces')
}
