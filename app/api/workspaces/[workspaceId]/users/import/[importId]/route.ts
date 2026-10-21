import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { importOutcome } from '@/lib/server/member-import'

// GET: a committed member import's rows and their current mail status (no passwords).
export const GET = workspaceRoute<'importId'>(
  ['admin'],
  async (_req, { user, params }) => {
    const outcome = await importOutcome(user.workspaceId, { id: params.importId })
    if (!outcome) return NextResponse.json({ error: 'Import not found' }, { status: 404 })
    return NextResponse.json(outcome)
  },
  { transaction: false }
)
