import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'
import type { CaughtError } from '@/lib/utils'

const MAX_ACTIVE_TAXONOMIES = 3

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { error } = await requireSession('admin')
  if (error) return error

  try {
    const { key } = await params

    // Check if taxonomy exists and is deleted
    const existingTaxonomy = await prisma.taxonomy.findUnique({
      where: { key }
    })

    if (!existingTaxonomy) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Taxonomy not found' 
      }, { status: 404 })
    }

    if (existingTaxonomy.isActive) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Taxonomy is already active' 
      }, { status: 400 })
    }

    // Check active taxonomy limit
    const activeTaxonomiesCount = await prisma.taxonomy.count({
      where: { isActive: true }
    })

    if (activeTaxonomiesCount >= MAX_ACTIVE_TAXONOMIES) {
      return NextResponse.json({ 
        ok: false, 
        error: `Maximum ${MAX_ACTIVE_TAXONOMIES} active taxonomies allowed. Please delete one before restoring.` 
      }, { status: 400 })
    }

    // Restore taxonomy
    const restoredTaxonomy = await prisma.taxonomy.update({
      where: { key },
      data: { isActive: true }
    })

    return NextResponse.json({ 
      ok: true, 
      taxonomy: restoredTaxonomy
    })

  } catch (caught) {

    const error = caught as CaughtError
    console.error('Restore taxonomy error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error?.message || String(error) 
    }, { status: 500 })
  }
}

