import { notFound } from 'next/navigation'
import GlobalShell from '@/components/GlobalShell'
import { requirePageSession } from '@/lib/server/page-user'
import { listAccessibleWorkspaces } from '@/lib/server/workspaces'
import { aiDeployment, listEndpoints } from '@/lib/ai-connections'
import { asJson } from '@/lib/server/json'
import AIEndpointsPanel from '@/app/workspaces/AIEndpointsPanel'
export default async function AIServicesPage() {
  const user = await requirePageSession()
  if (user.platformRole !== 'admin') notFound()
  const [endpoints, workspaces] = await Promise.all([
    listEndpoints({ includeRetired: true }),
    listAccessibleWorkspaces(user)
  ])
  return (
    <GlobalShell scopeKey={`${user.id}:${user.platformRole}`}>
      <div className="p-4 sm:p-8 max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900">AI services</h1>
        <AIEndpointsPanel
          initialEndpoints={asJson(endpoints)}
          deployment={aiDeployment()}
          workspaces={workspaces.map(w => ({ id: w.id, name: w.name }))}
        />
      </div>
    </GlobalShell>
  )
}
