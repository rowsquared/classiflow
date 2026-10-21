import LoadError from '@/components/LoadError'
import { workspaceAISettings } from '@/lib/ai-connections'
import { asJson } from '@/lib/server/json'
import { requirePageUser } from '@/lib/server/page-user'
import { withWorkspace } from '@/lib/workspace/db'
import AISettingsClient, { type AISettings } from './AISettingsClient'
import { logError } from '@/lib/logger'

export default async function AISettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await requirePageUser(workspaceId, 'admin')

  let settings
  try {
    settings = asJson(await withWorkspace(workspaceId, () => workspaceAISettings()))
  } catch (error) {
    await logError('AI settings page failed to load', error)
    return <LoadError title="AI Settings" what="the AI settings" />
  }

  return <AISettingsClient initial={settings as AISettings} archived={user.archived} />
}
