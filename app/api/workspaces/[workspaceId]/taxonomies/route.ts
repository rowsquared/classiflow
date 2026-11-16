import { NextResponse } from 'next/server'
import { db, inCurrentWorkspace, scopeWorkspaceId } from '@/lib/workspace/db'
import { workspaceRoute } from '@/lib/api-auth'
import type { CaughtError } from '@/lib/utils'
import { formatCsvErrors, parseTaxonomyCsv } from '@/lib/taxonomy-csv'
import { createTaxonomyNodes } from '@/lib/taxonomy-nodes'
import { readUpload } from '@/lib/upload'
import { audit } from '@/lib/audit'
import { listTaxonomiesWithStats } from '@/lib/server/taxonomies'
import { logError } from '@/lib/logger'
import { applyTaxonomyRequirement, lockActiveTaxonomies } from '@/lib/annotation-status'

const MAX_ACTIVE_TAXONOMIES = 3

export const GET = workspaceRoute([], async (_req, { user }) => {
  try {
    return NextResponse.json(await listTaxonomiesWithStats(user.workspaceId))
  } catch (error) {
    await logError('Failed to list taxonomies', error)
    return NextResponse.json({ ok: false, error: 'Failed to load taxonomies' }, { status: 500 })
  }
})

export const POST = workspaceRoute(['admin'], async (req, { user: actor }) => {
  try {
    const formData = await req.formData()

    const key = formData.get('key') as string
    const description = formData.get('description') as string | null
    const maxDepth = parseInt(formData.get('maxDepth') as string)
    const levelNamesStr = formData.get('levelNames') as string | null
    const file = formData.get('file')

    // Validation
    if (!key || !maxDepth || !file) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Missing required fields: key, maxDepth, file'
        },
        { status: 400 }
      )
    }
    // Keys become URL segments, export column prefixes and AI service identifiers.
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(key)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Key must be 1-50 letters, digits, "_" or "-", starting with a letter or digit'
        },
        { status: 400 }
      )
    }
    if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 5) {
      return NextResponse.json({ ok: false, error: 'maxDepth must be between 1 and 5' }, { status: 400 })
    }

    await lockActiveTaxonomies(db(), actor.workspaceId, true)
    const activeTaxonomiesCount = await db().taxonomy.count({ where: { isActive: true } })

    if (activeTaxonomiesCount >= MAX_ACTIVE_TAXONOMIES) {
      return NextResponse.json(
        {
          ok: false,
          error: `Maximum ${MAX_ACTIVE_TAXONOMIES} active taxonomies allowed. Please delete one before adding a new one.`
        },
        { status: 400 }
      )
    }

    // Check key uniqueness
    const existingTaxonomy = await db().taxonomy.findUnique({
      where: { workspaceId_key: { workspaceId: scopeWorkspaceId(), key } }
    })

    if (existingTaxonomy) {
      return NextResponse.json(
        {
          ok: false,
          error: `Taxonomy with key "${key}" already exists`
        },
        { status: 400 }
      )
    }

    // Parse level names if provided
    let levelNames = null
    if (levelNamesStr) {
      try {
        levelNames = JSON.parse(levelNamesStr)
      } catch {
        return NextResponse.json(
          {
            ok: false,
            error: 'Invalid levelNames JSON'
          },
          { status: 400 }
        )
      }
    }

    const upload = await readUpload(file)
    if (!upload.ok) {
      return NextResponse.json({ ok: false, error: upload.error }, { status: 400 })
    }
    const { nodes: parsedNodes, errors: validationErrors } = parseTaxonomyCsv(upload.text, { maxDepth })
    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: formatCsvErrors(validationErrors),
          errors: validationErrors
        },
        { status: 400 }
      )
    }

    // Create taxonomy and import nodes in transaction
    const result = await inCurrentWorkspace(async () => {
      const tx = db()
      // Create taxonomy
      const taxonomy = await tx.taxonomy.create({
        data: {
          workspaceId: actor.workspaceId,
          key,
          description: description || null,
          maxDepth,
          levelNames: levelNames || undefined
        }
      })

      await createTaxonomyNodes(tx, scopeWorkspaceId(), taxonomy.id, parsedNodes)
      await applyTaxonomyRequirement(tx, actor.workspaceId, taxonomy.id)

      return taxonomy
    })

    await audit({
      actorId: actor.id,
      action: 'taxonomy.created',
      entityType: 'taxonomy',
      entityId: result.id,
      payload: { key: result.key, nodes: parsedNodes.length }
    })
    return NextResponse.json({
      ok: true,
      taxonomy: result,
      importedNodes: parsedNodes.length
    })
  } catch (caught) {
    const error = caught as CaughtError
    await logError('Create taxonomy failed', error)

    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to create taxonomy'
      },
      { status: 500 }
    )
  }
})
