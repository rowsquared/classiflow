import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { listAudit } from '@/lib/audit'

export const GET = workspaceRoute(['admin'], async (req, { user }) =>
  NextResponse.json(await listAudit(user.workspaceId, req.nextUrl.searchParams))
)
