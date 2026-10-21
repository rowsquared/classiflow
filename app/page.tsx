import { redirect } from 'next/navigation'
import { requirePageSession } from '@/lib/server/page-user'
import { listAccessibleWorkspaces } from '@/lib/server/workspaces'

// One workspace: straight to its queue. Otherwise the chooser.
export default async function HomePage() {
  const workspaces = await listAccessibleWorkspaces(await requirePageSession())
  const active = workspaces.filter(w => w.status === 'active')
  if (active.length === 1) redirect(`/w/${active[0]!.id}/queue`)
  redirect('/workspaces')
}
