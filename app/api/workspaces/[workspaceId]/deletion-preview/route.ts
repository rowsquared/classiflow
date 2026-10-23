import { NextResponse } from 'next/server'
import { requirePlatformAdmin, notFound } from '@/lib/api-auth'
import { workspaceDeletionPreview } from '@/lib/server/workspaces'

export async function GET(_req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { error } = await requirePlatformAdmin()
  if (error) return error
  const preview = await workspaceDeletionPreview((await params).workspaceId)
  return preview ? NextResponse.json(preview) : notFound()
}
