import { redirect } from 'next/navigation'
import { requirePageSession } from '@/lib/server/page-user'
import { preferredWorkspace } from '@/lib/server/preferred-workspace'

// Only redirect to a workspace that is still active and accessible.
export default async function HomePage() {
  const user = await requirePageSession()
  const target = await preferredWorkspace(user)
  if (target) redirect(`/w/${target.id}/queue`)
  redirect('/workspaces')
}
