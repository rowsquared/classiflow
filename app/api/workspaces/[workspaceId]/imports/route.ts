import { NextResponse } from 'next/server'
import { listImports } from '@/lib/server/imports'
import { workspaceRoute } from '@/lib/api-auth'
import type { CaughtError } from '@/lib/utils'
import { logError } from '@/lib/logger'

export const GET = workspaceRoute([], async (_req, { user }) => {
  try {
    return NextResponse.json(await listImports(user.workspaceId))
  } catch (caught) {
    const e = caught as CaughtError
    await logError('Failed to fetch imports', e)
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || String(e)
      },
      { status: 500 }
    )
  }
})
