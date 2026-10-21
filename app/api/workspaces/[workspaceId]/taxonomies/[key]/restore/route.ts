import { NextResponse } from 'next/server'
import { db, scopeWorkspaceId } from '@/lib/workspace/db'
import { workspaceRoute } from '@/lib/api-auth'
import type { CaughtError } from '@/lib/utils'
import { audit } from '@/lib/audit'

const MAX_ACTIVE_TAXONOMIES = 3

export const POST = workspaceRoute(['admin'], async (req, { user: actor, params: routeParams }) => {
  try {
    const { key } = routeParams

    // Check if taxonomy exists and is deleted
    const existingTaxonomy = await db().taxonomy.findUnique({
      where: { workspaceId_key: { workspaceId: scopeWorkspaceId(), key } }
    })

    if (!existingTaxonomy) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Taxonomy not found'
        },
        { status: 404 }
      )
    }

    if (existingTaxonomy.isActive) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Taxonomy is already active'
        },
        { status: 400 }
      )
    }

    // Check active taxonomy limit
    const activeTaxonomiesCount = await db().taxonomy.count({
      where: { isActive: true }
    })

    if (activeTaxonomiesCount >= MAX_ACTIVE_TAXONOMIES) {
      return NextResponse.json(
        {
          ok: false,
          error: `Maximum ${MAX_ACTIVE_TAXONOMIES} active taxonomies allowed. Please delete one before restoring.`
        },
        { status: 400 }
      )
    }

    // Restore taxonomy
    const restoredTaxonomy = await db().taxonomy.update({
      where: { workspaceId_key: { workspaceId: scopeWorkspaceId(), key } },
      data: { isActive: true }
    })

    await audit({
      actorId: actor.id,
      action: 'taxonomy.restored',
      entityType: 'taxonomy',
      entityId: restoredTaxonomy.id,
      payload: { key: restoredTaxonomy.key }
    })
    return NextResponse.json({
      ok: true,
      taxonomy: restoredTaxonomy
    })
  } catch (caught) {
    const error = caught as CaughtError
    console.error('Restore taxonomy error:', error)
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || String(error)
      },
      { status: 500 }
    )
  }
})
