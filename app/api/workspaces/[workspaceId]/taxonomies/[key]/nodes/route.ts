import { NextResponse } from 'next/server'
import { workspaceRoute } from '@/lib/api-auth'
import { taxonomyNodesQuery } from '@/lib/contracts/taxonomy-nodes'
import { listTaxonomyNodes } from '@/lib/server/taxonomies'

export const GET = workspaceRoute<'key'>([], async (req, { user, params: { key } }) => {
  const parsed = taxonomyNodesQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid taxonomy query' }, { status: 400 })
  const result = await listTaxonomyNodes(user.workspaceId, key, parsed.data)
  return result ? NextResponse.json(result) : NextResponse.json({ error: 'Taxonomy not found' }, { status: 404 })
})
