import { NextResponse } from 'next/server'
import { listImports } from '@/lib/server/imports'
import { workspaceRoute } from '@/lib/api-auth'

export const GET = workspaceRoute([], async (_req, { user }) => NextResponse.json(await listImports(user)))
