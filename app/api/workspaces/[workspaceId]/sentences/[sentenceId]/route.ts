import { workspaceRoute } from '@/lib/api-auth'
import { getRecord } from '@/lib/server/record'

export const GET = workspaceRoute<'sentenceId'>([], async (_req, { user, params }) =>
  getRecord(user, params.sentenceId)
)
